import type { Prisma } from "@prisma/client";
import { textForViewer } from "../auth/masking";
import { adminDb } from "../db/adminClient";
import { logger } from "../lib/logger";
import {
  DELIVERY_MODES,
  TEAM_ACTIVITY_DEFAULT_CHANNELS,
  TEAM_ACTIVITY_HOURLY_CAP,
  TEAM_EVENT_DEFS,
  composeText,
  digestDueAt,
  findTeamEventDef,
  groupItems,
  isOverRateCap,
  windowLabel,
  type DeliveryMode,
  type TeamEventKey,
  type TeamGroup,
  type TeamItem,
} from "../notifications/teamActivity";
import { pushToMember } from "../notifications/webPush";
import { createNotificationDelivery } from "../repositories/notificationDeliveries";
import { createNotification } from "../repositories/notifications";
import {
  addPending,
  countTeamNotificationsSince,
  deleteDispatchedBefore,
  listTeamPreferences,
  listUndispatched,
  markDispatched,
  readPrefsAndQueue,
  type PendingInput,
  upsertTeamPreference,
  type TeamPreferenceRow,
} from "../repositories/teamActivity";
import { attemptDelivery } from "./notificationService";
import { memberTimeZone, planEmail } from "./notificationDeliveryPolicy";

/**
 * Team activity notifications (FIG-1600, P2-17). One shared helper, `emitTeamActivity`, is called by the services that
 * perform the action (lead, deal, company, contact, import and export runs, invitations, discount requests). It tells
 * every active Management member of the same organisation, never the person who did it, through the channels and the
 * delivery mode each person chose. The audit trail (P2-16) is not built yet, so the services call this directly; when it
 * is, an audit-event subscriber can call `emitTeamActivity` instead without changing anything below.
 *
 * Hooks left for later (not built, so nothing is sent for them): security events (P2-02), a new custom service (P2-12),
 * a Head of Sales grant and Head of Sales as a recipient (P2-14). Add the event to `TEAM_EVENT_DEFS`, call
 * `emitTeamActivity`, and the preferences screen, grouping, digests and masking all apply.
 *
 * Masking (rule 7): the text is composed per recipient. A deal value is only put in the text of a person who has
 * `deals.view.value`; everything also passes through `textForViewer`. Payment details are never composed at all.
 * Never throws: a notification must not fail the action that raised it.
 */

export const TEAM_DIGEST_JOB = "team_activity.digest";
const MANAGEMENT_ROLE_KEY = "MANAGEMENT";
const HOUR_MS = 60 * 60_000;
const SENT_ROW_KEEP_DAYS = 7;

function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

export interface TeamActivityEvent {
  organizationId: string;
  eventKey: TeamEventKey;
  /** The person who did it. Never notified. */
  actorMembershipId: string | null;
  entityType: string;
  entityId: string;
  /** Short name of the record: a company name, a contact name, "lead import". */
  label: string;
  /** Route under the organisation, such as `deals/123`; `/o/<slug>/` and the base URL are added. */
  route: string;
  detail?: TeamItem["detail"];
}

interface Recipient {
  membershipId: string;
  email: string | null;
  canSeeValue: boolean;
  permissionKeys: string[];
}

interface EffectivePref {
  inApp: boolean;
  email: boolean;
  push: boolean;
  mode: DeliveryMode;
}

function effectivePref(rows: TeamPreferenceRow[], membershipId: string, eventKey: TeamEventKey): EffectivePref {
  const def = findTeamEventDef(eventKey)!;
  const row = rows.find((r) => r.membershipId === membershipId && r.eventKey === eventKey);
  const mode = row?.mode && (DELIVERY_MODES as readonly string[]).includes(row.mode) ? (row.mode as DeliveryMode) : def.defaultMode;
  return row
    ? { inApp: row.inAppEnabled, email: row.emailEnabled, push: row.pushEnabled, mode }
    : { ...TEAM_ACTIVITY_DEFAULT_CHANNELS, mode };
}

/** Every active Management member of the organisation except the actor. Other roles and other organisations are never listed. */
export async function managementRecipients(organizationId: string, exceptMembershipId: string | null): Promise<Recipient[]> {
  const members = await adminDb.membership.findMany({
    where: { organizationId, status: "ACTIVE", role: { key: MANAGEMENT_ROLE_KEY }, ...(exceptMembershipId ? { id: { not: exceptMembershipId } } : {}) },
    select: { id: true, user: { select: { email: true } }, role: { select: { rolePermissions: { select: { permission: { select: { key: true } } } } } } },
  });
  return members.map((m) => {
    const permissionKeys = m.role.rolePermissions.map((rp) => rp.permission.key);
    return { membershipId: m.id, email: m.user.email, permissionKeys, canSeeValue: permissionKeys.includes("deals.view.value") };
  });
}

async function actorName(organizationId: string, membershipId: string | null): Promise<string> {
  if (!membershipId) return "Someone";
  const m = await adminDb.membership.findFirst({ where: { id: membershipId, organizationId }, select: { user: { select: { name: true } } } });
  return m?.user.name ?? "Someone";
}

/** Writes the in-app notification and queues the email and push for one group, for one recipient. */
async function deliverGroup(
  organizationId: string,
  recipient: Recipient,
  pref: EffectivePref,
  group: TeamGroup,
  window: string | undefined,
  now: Date,
): Promise<void> {
  const def = findTeamEventDef(group.eventKey)!;
  const name = await actorName(organizationId, group.actorMembershipId);
  const composed = composeText(group, name, { canSeeValue: recipient.canSeeValue, window });
  const viewer = { permissionKeys: recipient.permissionKeys };
  const title = textForViewer(viewer, composed.title);
  const body = textForViewer(viewer, composed.body);
  const single = group.items.length === 1 ? group.items[0]! : null;
  let path = single?.path;
  if (!path) {
    const org = await adminDb.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { slug: true } });
    path = `/o/${org.slug}/${def.listPath}`;
  }
  const link = `${appBaseUrl()}${path}`;

  let notificationId: string | undefined;
  if (pref.inApp) {
    const created = await createNotification({
      organizationId,
      membershipId: recipient.membershipId,
      type: "TEAM_ACTIVITY",
      title,
      body,
      entityType: single?.entityType ?? group.items[0]!.entityType,
      entityId: single?.entityId ?? group.items[0]!.entityId,
      link,
      actorMembershipId: group.actorMembershipId ?? undefined,
    });
    notificationId = created?.id;
  }

  if (pref.email && recipient.email) {
    const plan = await planEmail(organizationId, recipient.membershipId, "MENTION", now);
    const delivery = await createNotificationDelivery({
      organizationId,
      notificationId,
      channel: "EMAIL",
      recipientEmail: recipient.email,
      templateKey: "generic-notification",
      payload: { title, body, link } as Prisma.InputJsonValue,
      ...(plan.action === "send" ? {} : { nextAttemptAt: plan.until }),
    });
    if (plan.action === "send") await attemptDelivery(organizationId, { ...delivery, maxAttempts: delivery.maxAttempts });
  }

  if (pref.push) {
    await pushToMember(
      { organizationId, membershipId: recipient.membershipId, notificationId: notificationId ?? "", type: "TEAM_ACTIVITY", title, body, link, skipTypePreference: true },
      now,
    );
  }
}

/** Tells Management about one thing a team member did. Never throws. */
export async function emitTeamActivity(event: TeamActivityEvent, now: Date = new Date()): Promise<void> {
  try {
    const def = findTeamEventDef(event.eventKey);
    if (!def) return;
    const recipients = await managementRecipients(event.organizationId, event.actorMembershipId);
    if (recipients.length === 0) return;
    const org = await adminDb.organization.findUniqueOrThrow({ where: { id: event.organizationId }, select: { slug: true } });
    const path = `/o/${org.slug}/${event.route}`;
    const held = (membershipId: string, mode: string): PendingInput => ({
      organizationId: event.organizationId,
      recipientMembershipId: membershipId,
      eventKey: event.eventKey,
      actorMembershipId: event.actorMembershipId,
      entityType: event.entityType,
      entityId: event.entityId,
      label: event.label,
      path,
      detail: { ...(event.detail ?? {}), mode } as Prisma.InputJsonValue,
    });

    // One transaction reads the preferences and queues everything bound for a digest; only instant recipients need more work.
    const instant = await readPrefsAndQueue(event.organizationId, recipients.map((r) => r.membershipId), (prefs) => {
      const rows: PendingInput[] = [];
      const now_: { recipient: Recipient; pref: EffectivePref }[] = [];
      for (const recipient of recipients) {
        const pref = effectivePref(prefs, recipient.membershipId, event.eventKey);
        if (!pref.inApp && !pref.email && !pref.push) continue; // switched off for this person only
        if (pref.mode === "INSTANT") now_.push({ recipient, pref });
        else rows.push(held(recipient.membershipId, pref.mode));
      }
      return { rows, result: now_ };
    });

    for (const { recipient, pref } of instant) {
      try {
        const sent = await countTeamNotificationsSince(event.organizationId, recipient.membershipId, new Date(now.getTime() - HOUR_MS));
        if (isOverRateCap(sent, TEAM_ACTIVITY_HOURLY_CAP)) {
          await addPending(held(recipient.membershipId, "HOURLY")); // the per-person cap: the rest wait for the digest
        } else {
          const item: TeamItem = { eventKey: event.eventKey, actorMembershipId: event.actorMembershipId, entityType: event.entityType, entityId: event.entityId, label: event.label, path, detail: event.detail, createdAt: now };
          await deliverGroup(event.organizationId, recipient, pref, { eventKey: event.eventKey, actorMembershipId: event.actorMembershipId, items: [item] }, undefined, now);
        }
      } catch (err) {
        logger.error({ err, organizationId: event.organizationId, eventKey: event.eventKey }, "Team activity notification failed for one recipient");
      }
    }
  } catch (err) {
    logger.error({ err, organizationId: event.organizationId, eventKey: event.eventKey }, "Team activity notification failed");
  }
}

/**
 * The digest job (`team_activity.digest`, through the job framework and `/api/cron/jobs`). For each person, items held for
 * their hourly or daily digest that are due go out grouped, one notification per event and team member. Safe to repeat:
 * items are claimed (marked sent) before delivery, so a second run finds nothing.
 */
export async function flushTeamActivityDigests(organizationId: string, now: Date = new Date()): Promise<{ groups: number; items: number }> {
  const pending = await listUndispatched(organizationId);
  if (pending.length === 0) return { groups: 0, items: 0 };

  const recipients = new Map((await managementRecipients(organizationId, null)).map((r) => [r.membershipId, r]));
  const prefs = await listTeamPreferences(organizationId, [...recipients.keys()]);
  const byRecipient = new Map<string, typeof pending>();
  for (const p of pending) byRecipient.set(p.recipientMembershipId, [...(byRecipient.get(p.recipientMembershipId) ?? []), p]);

  let groups = 0;
  let sentItems = 0;
  for (const [recipientId, rows] of byRecipient) {
    const recipient = recipients.get(recipientId);
    if (!recipient) {
      // No longer an active Management member: nothing to tell them.
      await markDispatched(organizationId, rows.map((r) => r.id), now);
      continue;
    }
    const tz = await memberTimeZone(organizationId, recipientId);
    const items: (TeamItem & { rowId: string })[] = rows.map((r) => ({
      rowId: r.id,
      eventKey: r.eventKey as TeamEventKey,
      actorMembershipId: r.actorMembershipId,
      entityType: r.entityType,
      entityId: r.entityId,
      label: r.label,
      path: r.path,
      detail: (r.detail as TeamItem["detail"]) ?? null,
      createdAt: r.createdAt,
    }));
    for (const group of groupItems(items)) {
      const first = group.items[0]!;
      const mode = (first.detail?.mode === "DAILY" ? "DAILY" : "HOURLY") as Exclude<DeliveryMode, "INSTANT">;
      if (digestDueAt(mode, first.createdAt, tz).getTime() > now.getTime()) continue;
      const ids = group.items.map((i) => (i as TeamItem & { rowId: string }).rowId);
      const claimed = await markDispatched(organizationId, ids, now);
      if (claimed.count === 0) continue;
      try {
        const pref = effectivePref(prefs, recipientId, group.eventKey);
        if (pref.inApp || pref.email || pref.push) {
          await deliverGroup(organizationId, recipient, pref, group, group.items.length > 1 ? windowLabel(mode) : undefined, now);
          groups += 1;
          sentItems += group.items.length;
        }
      } catch (err) {
        logger.error({ err, organizationId, recipientId }, "Team activity digest failed");
      }
    }
  }
  await deleteDispatchedBefore(organizationId, new Date(now.getTime() - SENT_ROW_KEEP_DAYS * 24 * HOUR_MS));
  return { groups, items: sentItems };
}

// ---------------------------------------------------------------------------
// Preferences (shown in Preferences, Notifications, "Team activity")
// ---------------------------------------------------------------------------

export interface TeamActivityPreferenceView {
  event: TeamEventKey;
  label: string;
  description: string;
  channels: { inApp: boolean; email: boolean; push: boolean };
  mode: DeliveryMode;
  defaultMode: DeliveryMode;
}

export interface UpdateTeamActivityInput {
  [eventKey: string]: { inApp?: boolean; email?: boolean; push?: boolean; mode?: string };
}

export async function getTeamActivityPreferences(organizationId: string, membershipId: string): Promise<TeamActivityPreferenceView[]> {
  const rows = await listTeamPreferences(organizationId, [membershipId]);
  return TEAM_EVENT_DEFS.map((d) => {
    const p = effectivePref(rows, membershipId, d.key);
    return { event: d.key, label: d.label, description: d.description, channels: { inApp: p.inApp, email: p.email, push: p.push }, mode: p.mode, defaultMode: d.defaultMode };
  });
}

/** Validates and saves the caller's own choices. Returns the problems found (path and message) instead of saving anything when there are any. */
export async function updateTeamActivityPreferences(
  organizationId: string,
  membershipId: string,
  input: UpdateTeamActivityInput,
): Promise<{ path: string; message: string }[]> {
  const issues: { path: string; message: string }[] = [];
  for (const [event, change] of Object.entries(input)) {
    if (!findTeamEventDef(event)) issues.push({ path: `teamActivity.${event}`, message: `"${event}" is not a team activity event.` });
    else if (change.mode !== undefined && !(DELIVERY_MODES as readonly string[]).includes(change.mode)) {
      issues.push({ path: `teamActivity.${event}.mode`, message: `Choose one of: ${DELIVERY_MODES.join(", ")}.` });
    }
  }
  if (issues.length > 0) return issues;
  for (const [event, change] of Object.entries(input)) {
    await upsertTeamPreference(organizationId, membershipId, event, {
      ...(change.inApp !== undefined ? { inAppEnabled: change.inApp } : {}),
      ...(change.email !== undefined ? { emailEnabled: change.email } : {}),
      ...(change.push !== undefined ? { pushEnabled: change.push } : {}),
      ...(change.mode !== undefined ? { mode: change.mode as DeliveryMode } : {}),
    });
  }
  return [];
}

// ---------------------------------------------------------------------------
// Small helpers for the services that raise events
// ---------------------------------------------------------------------------

/** A readable name for a lead: its company, else its contact, else "a new lead". */
export async function leadLabelFor(organizationId: string, lead: { companyId?: string | null; contactId?: string | null }): Promise<string> {
  try {
    if (lead.companyId) {
      const c = await adminDb.company.findFirst({ where: { id: lead.companyId, organizationId }, select: { name: true } });
      if (c) return c.name;
    }
    if (lead.contactId) {
      const c = await adminDb.contact.findFirst({ where: { id: lead.contactId, organizationId }, select: { firstName: true, lastName: true } });
      if (c) return [c.firstName, c.lastName].filter(Boolean).join(" ");
    }
  } catch {
    // a label is only a label
  }
  return "a new lead";
}

export async function companyNameFor(organizationId: string, companyId: string): Promise<string> {
  const c = await adminDb.company.findFirst({ where: { id: companyId, organizationId }, select: { name: true } });
  return c?.name ?? "a company";
}
