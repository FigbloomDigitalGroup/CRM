import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { adminDb } from "../db/adminClient";
import { logger } from "../lib/logger";
import {
  sendLeadAssignedEmail,
  sendTaskDueEmail,
  sendTaskOverdueEmail,
  sendWebsiteLeadAcknowledgementEmail,
} from "../notifications/email";
import { deliverSmsOrLog } from "../notifications/sms";
import {
  createNotificationDelivery,
  listDueDeliveries,
  markDeliveryFailed,
  markDeliverySent,
} from "../repositories/notificationDeliveries";
import {
  NOTIFICATION_TYPES,
  resolveEffectivePreference,
  resolveEffectivePreferences,
  upsertPreference,
  type NotificationTypeKey,
} from "../repositories/notificationPreferences";
import {
  createNotification,
  listNotificationsForMembership,
  markAllNotificationsRead as markAllNotificationsReadRecord,
  markNotificationRead as markNotificationReadRecord,
} from "../repositories/notifications";

const WEBSITE_ACKNOWLEDGEMENT_SETTING_KEY = "website_lead_acknowledgement";

function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

async function getOrganizationBasics(organizationId: string) {
  return adminDb.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { slug: true, name: true },
  });
}

async function getMembershipEmail(
  organizationId: string,
  membershipId: string,
): Promise<string | null> {
  const membership = await adminDb.membership.findFirst({
    where: { id: membershipId, organizationId },
    include: { user: true },
  });
  return membership?.user.email ?? null;
}

/**
 * Looks up the right send function by `templateKey` + `channel` and
 * delivers it. Only ever called with a delivery row's own already-stored
 * `payload` -- enough to re-render the message on retry without
 * re-deriving it from (possibly since-changed) business records.
 */
async function dispatch(
  channel: "EMAIL" | "SMS" | "WHATSAPP",
  templateKey: string,
  recipient: { email: string | null; phone: string | null },
  payload: Record<string, unknown>,
): Promise<void> {
  if (channel === "EMAIL") {
    if (!recipient.email) throw new Error("No recipient email on this delivery.");
    switch (templateKey) {
      case "lead-assigned":
        return sendLeadAssignedEmail(recipient.email, payload as { leadLabel: string; link: string });
      case "task-due":
        return sendTaskDueEmail(recipient.email, payload as { taskTitle: string; link: string });
      case "task-overdue":
        return sendTaskOverdueEmail(recipient.email, payload as { taskTitle: string; link: string });
      case "website-lead-ack":
        return sendWebsiteLeadAcknowledgementEmail(
          recipient.email,
          payload as { organizationName: string; enquirerName: string },
        );
      default:
        throw new Error(`Unknown email templateKey "${templateKey}".`);
    }
  }

  // SMS/WhatsApp (FIG-597 AC: optional) -- see src/notifications/sms.ts's
  // header comment for why this logs rather than really sends today.
  if (!recipient.phone) throw new Error("No recipient phone on this delivery.");
  const body =
    templateKey === "website-lead-ack"
      ? `Thanks for reaching out to ${(payload as { organizationName: string }).organizationName}. We'll be in touch shortly.`
      : JSON.stringify(payload);
  await deliverSmsOrLog(templateKey, { to: recipient.phone, body });
}

/** Attempts one delivery now; updates its own status/attempts/backoff on failure rather than throwing to the caller -- a notification failure must never fail the business action that triggered it. */
async function attemptDelivery(
  organizationId: string,
  delivery: {
    id: string;
    channel: "EMAIL" | "SMS" | "WHATSAPP";
    templateKey: string;
    recipientEmail: string | null;
    recipientPhone: string | null;
    payload: unknown;
    attempts: number;
    maxAttempts: number;
  },
): Promise<void> {
  try {
    await dispatch(
      delivery.channel,
      delivery.templateKey,
      { email: delivery.recipientEmail, phone: delivery.recipientPhone },
      (delivery.payload as Record<string, unknown>) ?? {},
    );
    await markDeliverySent(organizationId, delivery.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown delivery error.";
    logger.error({ err, deliveryId: delivery.id }, "Notification delivery attempt failed");
    await markDeliveryFailed(
      organizationId,
      delivery.id,
      delivery.attempts + 1,
      delivery.maxAttempts,
      message,
    );
  }
}

interface NotifyInput {
  organizationId: string;
  membershipId: string;
  type: NotificationTypeKey;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  link: string;
  emailPayload: Record<string, unknown>;
  templateKey: string;
}

/**
 * Shared engine behind `notifyLeadAssigned`/`notifyTaskDue`/
 * `notifyTaskOverdue`: create the in-app Notification (idempotent -- a
 * second call for the same entity+type is a silent no-op, see
 * `createNotification`), then queue and best-effort-attempt an email
 * delivery if the recipient's preference allows it and they have an email.
 * Never throws -- a notification is always secondary to whatever business
 * action triggered it.
 */
async function notify(input: NotifyInput): Promise<void> {
  try {
    const notification = await createNotification({
      organizationId: input.organizationId,
      membershipId: input.membershipId,
      type: input.type,
      title: input.title,
      body: input.body,
      entityType: input.entityType,
      entityId: input.entityId,
      link: input.link,
    });
    if (!notification) return; // already notified for this entity+type

    const preference = await resolveEffectivePreference(
      input.organizationId,
      input.membershipId,
      input.type,
    );
    if (!preference.emailEnabled) return;

    const email = await getMembershipEmail(input.organizationId, input.membershipId);
    if (!email) return;

    const delivery = await createNotificationDelivery({
      organizationId: input.organizationId,
      notificationId: notification.id,
      channel: "EMAIL",
      recipientEmail: email,
      templateKey: input.templateKey,
      payload: input.emailPayload as Prisma.InputJsonValue,
    });
    await attemptDelivery(input.organizationId, { ...delivery, maxAttempts: delivery.maxAttempts });
  } catch (err) {
    logger.error({ err, ...input }, "Failed to create/deliver notification");
  }
}

/**
 * Best-effort (FIG-597): a notification/delivery failure must never fail
 * or undo the business action that triggered it (a lead reassignment, a
 * task crossing into due/overdue). Every exported `notify*` function below
 * follows this same catch-and-log-only contract.
 */
export async function notifyLeadAssigned(
  organizationId: string,
  membershipId: string,
  lead: { id: string; label: string },
): Promise<void> {
  try {
    const org = await getOrganizationBasics(organizationId);
    const link = `${appBaseUrl()}/o/${org.slug}/leads/${lead.id}`;
    await notify({
      organizationId,
      membershipId,
      type: "LEAD_ASSIGNED",
      title: "New lead assigned to you",
      body: lead.label,
      entityType: "Lead",
      entityId: lead.id,
      link,
      templateKey: "lead-assigned",
      emailPayload: { leadLabel: lead.label, link },
    });
  } catch (err) {
    logger.error({ err, organizationId, membershipId }, "Failed to notify lead assignment");
  }
}

async function notifyTask(
  type: "TASK_DUE" | "TASK_OVERDUE",
  organizationId: string,
  membershipId: string,
  task: { id: string; title: string },
): Promise<void> {
  try {
    const org = await getOrganizationBasics(organizationId);
    const link = `${appBaseUrl()}/o/${org.slug}/tasks/${task.id}`;
    const dueLabel = type === "TASK_DUE" ? "due today" : "overdue";
    await notify({
      organizationId,
      membershipId,
      type,
      title: `Task ${dueLabel}: ${task.title}`,
      body: task.title,
      entityType: "Task",
      entityId: task.id,
      link,
      templateKey: type === "TASK_DUE" ? "task-due" : "task-overdue",
      emailPayload: { taskTitle: task.title, link },
    });
  } catch (err) {
    logger.error({ err, organizationId, membershipId }, "Failed to notify task due/overdue");
  }
}

export const notifyTaskDue = (
  organizationId: string,
  membershipId: string,
  task: { id: string; title: string },
) => notifyTask("TASK_DUE", organizationId, membershipId, task);

export const notifyTaskOverdue = (
  organizationId: string,
  membershipId: string,
  task: { id: string; title: string },
) => notifyTask("TASK_OVERDUE", organizationId, membershipId, task);

/**
 * The one delivery with no internal recipient -- an external enquirer, not
 * a membership (FIG-597 AC: "website enquiry acknowledgement sent to the
 * enquirer, configurable per organization"). Off by default; see
 * `getWebsiteAcknowledgementSetting`/`setWebsiteAcknowledgementSetting`.
 * Never throws -- called best-effort from `websiteLeadService.submitWebsiteLead`
 * after the lead is already committed, so a delivery failure here must
 * never affect the public API's response.
 */
export async function sendWebsiteLeadAcknowledgement(
  organizationId: string,
  enquirer: { name: string; email?: string; phone?: string },
): Promise<void> {
  try {
    const enabled = await getWebsiteAcknowledgementSettingByOrgId(organizationId);
    if (!enabled) return;
    if (!enquirer.email && !enquirer.phone) return;

    const org = await getOrganizationBasics(organizationId);
    const payload = { organizationName: org.name, enquirerName: enquirer.name };

    const delivery = await createNotificationDelivery({
      organizationId,
      channel: enquirer.email ? "EMAIL" : "SMS",
      recipientEmail: enquirer.email,
      recipientPhone: enquirer.phone,
      templateKey: "website-lead-ack",
      payload,
    });
    await attemptDelivery(organizationId, { ...delivery, maxAttempts: delivery.maxAttempts });
  } catch (err) {
    logger.error({ err, organizationId }, "Failed to send website lead acknowledgement");
  }
}

async function getWebsiteAcknowledgementSettingByOrgId(
  organizationId: string,
): Promise<boolean> {
  const setting = await adminDb.organizationSetting.findUnique({
    where: {
      organizationId_key: { organizationId, key: WEBSITE_ACKNOWLEDGEMENT_SETTING_KEY },
    },
  });
  return Boolean((setting?.value as { enabled?: boolean } | null)?.enabled);
}

/** Org-level toggle (Management only) -- gates `sendWebsiteLeadAcknowledgement` above. Off unless explicitly turned on. */
export async function getWebsiteAcknowledgementSetting(
  ctx: AuthContext,
): Promise<{ enabled: boolean }> {
  requirePermission(ctx, "organization.manage_settings");
  const enabled = await getWebsiteAcknowledgementSettingByOrgId(ctx.organizationId);
  return { enabled };
}

export async function setWebsiteAcknowledgementSetting(
  ctx: AuthContext,
  enabled: boolean,
): Promise<{ enabled: boolean }> {
  requirePermission(ctx, "organization.manage_settings");
  await adminDb.organizationSetting.upsert({
    where: {
      organizationId_key: {
        organizationId: ctx.organizationId,
        key: WEBSITE_ACKNOWLEDGEMENT_SETTING_KEY,
      },
    },
    update: { value: { enabled } },
    create: {
      organizationId: ctx.organizationId,
      key: WEBSITE_ACKNOWLEDGEMENT_SETTING_KEY,
      value: { enabled },
    },
  });
  return { enabled };
}

// ---------------------------------------------------------------------------
// In-app notification feed (self-service -- no permission beyond being an
// active member of the organization, same as "manage your own session")
// ---------------------------------------------------------------------------

/**
 * The Notification row is always created regardless of the `inAppEnabled`
 * preference (it's also the dedup ledger the due/overdue scan relies on,
 * and may still back an email even when hidden from the feed) -- disabling
 * "in-app" for a type is enforced here, at read time, rather than by
 * skipping the write.
 */
export async function listMyNotifications(
  ctx: AuthContext,
  filters: { unreadOnly?: boolean } = {},
) {
  const [rows, preferences] = await Promise.all([
    listNotificationsForMembership(ctx.organizationId, ctx.membershipId, filters),
    resolveEffectivePreferences(ctx.organizationId, ctx.membershipId),
  ]);
  return rows.filter((r) => preferences[r.type as NotificationTypeKey].inAppEnabled);
}

export async function getMyUnreadNotificationCount(ctx: AuthContext) {
  const [rows, preferences] = await Promise.all([
    listNotificationsForMembership(ctx.organizationId, ctx.membershipId, {
      unreadOnly: true,
      limit: 200,
    }),
    resolveEffectivePreferences(ctx.organizationId, ctx.membershipId),
  ]);
  return rows.filter((r) => preferences[r.type as NotificationTypeKey].inAppEnabled).length;
}

export async function markNotificationRead(ctx: AuthContext, notificationId: string) {
  return markNotificationReadRecord(ctx.organizationId, ctx.membershipId, notificationId);
}

export async function markAllNotificationsRead(ctx: AuthContext) {
  return markAllNotificationsReadRecord(ctx.organizationId, ctx.membershipId);
}

export async function getMyNotificationPreferences(ctx: AuthContext) {
  return resolveEffectivePreferences(ctx.organizationId, ctx.membershipId);
}

export async function updateMyNotificationPreference(
  ctx: AuthContext,
  type: NotificationTypeKey,
  input: { emailEnabled?: boolean; inAppEnabled?: boolean },
) {
  if (!NOTIFICATION_TYPES.includes(type)) {
    throw new Error(`Unknown notification type "${type}".`);
  }
  return upsertPreference(ctx.organizationId, ctx.membershipId, type, input);
}

// ---------------------------------------------------------------------------
// Retry sweep (FIG-597: "delivery failures logged and retried") -- called by
// `scripts/notifications-sweep.ts`, one organization at a time. No job queue
// exists in this project (see docs/DEPLOYMENT.md), so this is designed to be
// safely re-run on an interval by whatever recurring-task mechanism the
// deploy host provides.
// ---------------------------------------------------------------------------

export async function retryDueDeliveries(
  organizationId: string,
  limit = 100,
): Promise<{ attempted: number }> {
  const due = await listDueDeliveries(organizationId, limit);
  for (const delivery of due) {
    await attemptDelivery(organizationId, delivery);
  }
  return { attempted: due.length };
}
