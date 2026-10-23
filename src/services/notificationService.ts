import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { adminDb } from "../db/adminClient";
import { logger } from "../lib/logger";
import {
  sendDealWonHandoffEmail,
  sendGenericNotificationEmail,
  sendLeadAssignedEmail,
  sendNotificationDigestEmail,
  sendTaskDueEmail,
  sendTaskOverdueEmail,
  sendWebsiteLeadAcknowledgementEmail,
} from "../notifications/email";
import { deliverSmsOrLog } from "../notifications/sms";
import { findActiveLeadIdsOwnedBy } from "../repositories/leads";
import {
  createNotificationDelivery,
  listDueDeliveries,
  listDueDigestDeliveries,
  markDeliveriesSent,
  markDeliveryFailed,
  markDeliverySent,
  rescheduleDelivery,
} from "../repositories/notificationDeliveries";
import { ValidationError } from "../auth/errors";
import { ALWAYS_ON_TYPES } from "../notifications/catalogue";
import { planEmail } from "./notificationDeliveryPolicy";
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
      case "deal-won-handoff":
        return sendDealWonHandoffEmail(
          recipient.email,
          payload as { dealLabel: string; taskCount: number; link: string },
        );
      case "task-due":
        return sendTaskDueEmail(recipient.email, payload as { taskTitle: string; link: string });
      case "task-overdue":
        return sendTaskOverdueEmail(recipient.email, payload as { taskTitle: string; link: string });
      case "generic-notification":
        return sendGenericNotificationEmail(recipient.email, payload as { title: string; body: string; link: string });
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

    // B1.11: the in-app notification above is immediate; the email follows the person's
    // quiet hours and daily cap (see notificationDeliveryPolicy.ts).
    const plan = await planEmail(input.organizationId, input.membershipId, input.type);
    const delivery = await createNotificationDelivery({
      organizationId: input.organizationId,
      notificationId: notification.id,
      channel: "EMAIL",
      recipientEmail: email,
      templateKey: input.templateKey,
      payload: input.emailPayload as Prisma.InputJsonValue,
      ...(plan.action === "defer" ? { nextAttemptAt: plan.until } : {}),
      ...(plan.action === "digest" ? { nextAttemptAt: plan.until, digestPending: true } : {}),
    });
    if (plan.action !== "send") return;
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

/**
 * Tells the Delivery owner a won deal has been handed to them (FIG-792,
 * DEAL_WON_HANDOFF). Same best-effort contract as `notifyLeadAssigned`.
 */
export async function notifyDealWonHandoff(
  organizationId: string,
  membershipId: string,
  deal: { id: string; label: string; taskCount: number },
): Promise<void> {
  try {
    const org = await getOrganizationBasics(organizationId);
    const link = `${appBaseUrl()}/o/${org.slug}/deals/${deal.id}`;
    await notify({
      organizationId,
      membershipId,
      type: "DEAL_WON_HANDOFF",
      title: `Deal won, handed off to you: ${deal.label}`,
      body: `${deal.taskCount} onboarding task${deal.taskCount === 1 ? "" : "s"} assigned to you`,
      entityType: "Deal",
      entityId: deal.id,
      link,
      templateKey: "deal-won-handoff",
      emailPayload: { dealLabel: deal.label, taskCount: deal.taskCount, link },
    });
  } catch (err) {
    logger.error({ err, organizationId, membershipId }, "Failed to notify deal won handoff");
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
    // Tasks has no own detail route (FIG-787) -- the anchor lands on the
    // Tasks list scrolled to this row (see TaskSection.tsx's `#task-{id}`
    // and globals.css's `tr:target` highlight). This used to point at
    // `/tasks/${task.id}`, a route that has never existed.
    const link = `${appBaseUrl()}/o/${org.slug}/tasks#task-${task.id}`;
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
 * Raises any of the nine notification types (B1.11): the in-app notification
 * now, the email under the person's quiet hours and daily cap. Features raise
 * their own events through here (mentions, renewals, unanswered proposals,
 * stalled deals, support-access requests). Same best-effort contract as the
 * rest: never throws.
 */
export async function notifyEvent(input: {
  organizationId: string;
  membershipId: string;
  type: NotificationTypeKey;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  /** Path under the app, such as `/o/acme/deals/123`; the base URL is added. */
  path: string;
}): Promise<void> {
  const link = `${appBaseUrl()}${input.path}`;
  await notify({
    organizationId: input.organizationId,
    membershipId: input.membershipId,
    type: input.type,
    title: input.title,
    body: input.body,
    entityType: input.entityType,
    entityId: input.entityId,
    link,
    templateKey: "generic-notification",
    emailPayload: { title: input.title, body: input.body, link },
  });
}

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
 *
 * "New lead assigned" rows are a history log, but the feed must only show
 * what is still true, so the same read-time pass also drops a LEAD_ASSIGNED
 * row when (a) the lead has since been reassigned away from this member,
 * archived, or no longer exists, or (b) a newer row for the same lead is
 * already present (a lead assigned to you twice is still one lead). That
 * keeps the bell consistent with the dashboard and Leads list, which count
 * exactly the leads you currently own.
 */
async function visibleNotifications(
  ctx: AuthContext,
  rows: Awaited<ReturnType<typeof listNotificationsForMembership>>,
) {
  const preferences = await resolveEffectivePreferences(
    ctx.organizationId,
    ctx.membershipId,
  );
  const enabled = rows.filter(
    (r) => preferences[r.type as NotificationTypeKey].inAppEnabled,
  );

  const leadIds = [
    ...new Set(
      enabled
        .filter((r) => r.type === "LEAD_ASSIGNED" && r.entityId)
        .map((r) => r.entityId as string),
    ),
  ];
  const stillOwned = await findActiveLeadIdsOwnedBy(
    ctx.organizationId,
    ctx.membershipId,
    leadIds,
  );

  const seenLeads = new Set<string>();
  return enabled.filter((r) => {
    if (r.type !== "LEAD_ASSIGNED") return true;
    if (!r.entityId || !stillOwned.has(r.entityId)) return false;
    if (seenLeads.has(r.entityId)) return false; // rows arrive newest-first
    seenLeads.add(r.entityId);
    return true;
  });
}

const FEED_PAGE_SIZE = 50;
const FEED_SCAN_LIMIT = 200;

export async function listMyNotifications(
  ctx: AuthContext,
  filters: { unreadOnly?: boolean } = {},
) {
  const rows = await listNotificationsForMembership(
    ctx.organizationId,
    ctx.membershipId,
    { ...filters, limit: FEED_SCAN_LIMIT },
  );
  return (await visibleNotifications(ctx, rows)).slice(0, FEED_PAGE_SIZE);
}

export async function getMyUnreadNotificationCount(ctx: AuthContext) {
  const rows = await listNotificationsForMembership(
    ctx.organizationId,
    ctx.membershipId,
    { unreadOnly: true, limit: FEED_SCAN_LIMIT },
  );
  return (await visibleNotifications(ctx, rows)).length;
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
  if (ALWAYS_ON_TYPES.includes(type) && (input.emailEnabled === false || input.inAppEnabled === false)) {
    throw alwaysOn(type);
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
): Promise<{ attempted: number; deferred: number; digests: number }> {
  const due = await listDueDeliveries(organizationId, limit);
  let attempted = 0;
  let deferred = 0;
  for (const delivery of due) {
    // B1.11: a held email is re-checked against quiet hours and the cap at the moment it would
    // leave, so a morning flush of overnight emails cannot blow through the daily limit.
    if (delivery.notification) {
      const plan = await planEmail(organizationId, delivery.notification.membershipId, delivery.notification.type);
      if (plan.action === "defer") {
        await rescheduleDelivery(organizationId, delivery.id, { nextAttemptAt: plan.until });
        deferred++;
        continue;
      }
      if (plan.action === "digest") {
        await rescheduleDelivery(organizationId, delivery.id, { nextAttemptAt: plan.until, digestPending: true });
        deferred++;
        continue;
      }
    }
    await attemptDelivery(organizationId, delivery);
    attempted++;
  }
  const digests = await sendDueDigests(organizationId);
  return { attempted, deferred, digests };
}

/**
 * One email per person for everything the daily cap held back (B1.11). Runs
 * from the sweep; a held delivery becomes due at the start of the next day
 * (after quiet hours), so the digest reads "yesterday's overflow".
 */
export async function sendDueDigests(organizationId: string): Promise<number> {
  const due = await listDueDigestDeliveries(organizationId);
  const byMember = new Map<string, typeof due>();
  for (const d of due) {
    if (!d.notification) continue;
    const list = byMember.get(d.notification.membershipId) ?? [];
    list.push(d);
    byMember.set(d.notification.membershipId, list);
  }
  let sent = 0;
  for (const [membershipId, group] of byMember) {
    const recipientEmail = group[0]!.recipientEmail;
    if (!recipientEmail) continue;
    // Quiet hours may have been switched on since it was held.
    const plan = await planEmail(organizationId, membershipId, "MENTION");
    if (plan.action === "defer") {
      for (const d of group) await rescheduleDelivery(organizationId, d.id, { nextAttemptAt: plan.until });
      continue;
    }
    try {
      await sendNotificationDigestEmail(recipientEmail, {
        items: group.map((d) => ({
          title: d.notification!.title,
          body: d.notification!.body,
          link: d.notification!.link,
        })),
      });
      await markDeliveriesSent(organizationId, group.map((d) => d.id));
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown delivery error.";
      logger.error({ err, membershipId }, "Notification digest failed");
      for (const d of group) {
        await markDeliveryFailed(organizationId, d.id, d.attempts + 1, d.maxAttempts, message);
      }
    }
  }
  return sent;
}

export function alwaysOn(type: string) {
  const message = "Overdue task alerts cannot be turned off, so a missed deadline is never hidden from you.";
  return new ValidationError(message, [{ path: `types.${type}`, code: "NOTIFICATION_ALWAYS_ON", message }]);
}
