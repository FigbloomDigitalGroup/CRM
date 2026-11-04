import type { CalendarEventLink, OAuthConnection } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { getCalendarProvider, type ProviderEvent } from "../integrations/calendar/types";
import { OAuthTransientError, type OAuthProviderKey } from "../integrations/oauth/types";
import { recordAuditEvent } from "../repositories/auditEvents";
import { createCommunication as createCommunicationRecord } from "../repositories/communications";
import { findContactByEmail } from "../repositories/contacts";
import { createActivity } from "./activityService";
import { ConnectionUnavailableError, findConnectionFor, getAccessToken, getUsableConnection, recordSyncResult } from "./oauthConnectionService";
import { assertCanAccessLinkedRecords, type LinkedRecordIds } from "./recordAccess";
import { createTask } from "./taskService";

/**
 * Meetings and calendar sync through a connected Google or Microsoft calendar (FIG-808, backend of Video Conference F6.23).
 *
 *  - Scheduling from a lead, deal, company or contact creates the event in the person's calendar with invites and (when asked)
 *    a Google Meet or Teams link, returns the join link, records a MEETING activity and logs the meeting once on the timeline
 *    and in Conversations (the Meetings tab reads MEETING communications). An optional follow-up task goes in the same call.
 *  - Rescheduling and cancelling change the event at the provider and the CRM together.
 *  - The sync pulls events with known contacts as MEETING activities, applies updates and cancellations both ways, and pairs every
 *    event with its activity once (`calendar_event_links`), so nothing is duplicated, including the CRM's own events coming back.
 *  - Tasks go to the calendar only when the person chose two-way sync (`settings.syncTasks`).
 *  - No video engine, recording or transcription.
 */
const MAX_ATTENDEES = 50;
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const FIRST_SYNC_DAYS = 14;
const SYNC_BATCH = 200;

export interface CalendarSettings {
  calendarId: string;
  syncEnabled: boolean;
  syncTasks: boolean;
}

export function readCalendarSettings(connection: Pick<OAuthConnection, "settings">): CalendarSettings {
  const s = (connection.settings ?? {}) as Record<string, unknown>;
  return { calendarId: typeof s.calendarId === "string" && s.calendarId ? s.calendarId : "primary", syncEnabled: s.syncEnabled !== false, syncTasks: s.syncTasks === true };
}

/** Which calendar the person chose is checked against what the provider lists, so a typed-in id of someone else's calendar is refused. */
export async function listProviderCalendars(ctx: AuthContext, connectionId: string) {
  const connection = await getUsableConnection(ctx.organizationId, connectionId);
  if (connection.kind !== "CALENDAR") throw new NotFoundError("Connection", connectionId);
  if (connection.membershipId !== ctx.membershipId && !hasPermission(ctx, "configuration.manage")) throw new NotFoundError("Connection", connectionId);
  const { token } = await getAccessToken(ctx.organizationId, connectionId);
  const provider = await getCalendarProvider(connection.provider as OAuthProviderKey);
  return { items: await provider.listCalendars(token), selected: readCalendarSettings(connection).calendarId };
}

function cleanAttendees(input: unknown, extra: string[]): string[] {
  const list = [...new Set([...(Array.isArray(input) ? input : []), ...extra].map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
  const bad = list.filter((a) => !EMAIL.test(a));
  if (bad.length) throw new ValidationError("Some attendee email addresses are not valid.", [{ path: "attendees", message: `Check: ${bad.join(", ")}` }]);
  if (list.length > MAX_ATTENDEES) throw new ValidationError(`At most ${MAX_ATTENDEES} attendees.`, [{ path: "attendees", message: "Too many attendees." }]);
  return list;
}

export interface ScheduleMeetingInput {
  title: string;
  start: string;
  end?: string;
  description?: string;
  attendees?: string[];
  withVideo?: boolean;
  link: { type: "Lead" | "Deal" | "Company" | "Contact"; id: string };
  followUp?: { title: string; dueAt?: string };
}

const idsOf = (link: ScheduleMeetingInput["link"]): LinkedRecordIds => ({
  leadId: link.type === "Lead" ? link.id : undefined,
  dealId: link.type === "Deal" ? link.id : undefined,
  companyId: link.type === "Company" ? link.id : undefined,
  contactId: link.type === "Contact" ? link.id : undefined,
});

const meetingView = (link: CalendarEventLink, activityId: string | null) => ({
  activityId,
  linkId: link.id,
  title: link.title,
  start: link.startsAt,
  end: link.endsAt,
  attendees: link.attendees,
  joinUrl: link.joinUrl,
  status: link.status,
});

async function ownConnection(ctx: AuthContext): Promise<OAuthConnection> {
  const connection = await findConnectionFor(ctx.organizationId, ctx.membershipId, "CALENDAR");
  if (!connection) throw new ConnectionUnavailableError("DISCONNECTED", "No calendar is connected. Connect Google or Microsoft calendar in Settings to schedule meetings.");
  return connection;
}

/** The contact email of the record a meeting is about, so the invite reaches them without typing it. */
async function recordContactEmails(ctx: AuthContext, ids: LinkedRecordIds): Promise<string[]> {
  const org = ctx.organizationId;
  const contactId = ids.contactId ?? (ids.leadId ? (await adminDb.lead.findFirst({ where: { id: ids.leadId, organizationId: org }, select: { contactId: true } }))?.contactId : undefined) ?? (ids.dealId ? (await adminDb.deal.findFirst({ where: { id: ids.dealId, organizationId: org }, select: { primaryContactId: true } }))?.primaryContactId : undefined);
  if (!contactId) return [];
  const contact = await adminDb.contact.findFirst({ where: { id: contactId, organizationId: org }, select: { email: true } });
  return contact?.email ? [contact.email.toLowerCase()] : [];
}

export async function scheduleMeeting(ctx: AuthContext, input: ScheduleMeetingInput) {
  requirePermission(ctx, "activities.create");
  const title = input.title?.trim();
  if (!title) throw new ValidationError("A title is required.", [{ path: "title", message: "Name the meeting." }]);
  const start = new Date(input.start);
  if (Number.isNaN(start.getTime())) throw new ValidationError("The start time is not valid.", [{ path: "start", message: "Use an ISO date and time." }]);
  const end = input.end ? new Date(input.end) : new Date(start.getTime() + 30 * 60_000);
  if (Number.isNaN(end.getTime()) || end <= start) throw new ValidationError("The meeting must end after it starts.", [{ path: "end", message: "Pick an end after the start." }]);
  if (end.getTime() - start.getTime() > 24 * 3_600_000) throw new ValidationError("A meeting is at most a day long.", [{ path: "end", message: "Too long." }]);
  const ids = idsOf(input.link);
  await assertCanAccessLinkedRecords(ctx, ids, { requireAtLeastOne: true, requireWritable: true });
  const connection = await ownConnection(ctx);
  const attendees = cleanAttendees(input.attendees, await recordContactEmails(ctx, ids)).filter((a) => a !== connection.accountEmail);
  const settings = readCalendarSettings(connection);

  const activity = await createActivity(ctx, { type: "MEETING", subject: title, description: input.description, occurredAt: start, ...ids });
  let event: ProviderEvent;
  try {
    const { token } = await getAccessToken(ctx.organizationId, connection.id);
    const provider = await getCalendarProvider(connection.provider as OAuthProviderKey);
    event = await provider.createEvent(token, settings.calendarId, { title, description: input.description ?? null, start, end, attendees, withVideo: input.withVideo === true, requestId: activity.id });
  } catch (err) {
    // The meeting does not exist at the provider, so it must not exist here either.
    await adminDb.activity.delete({ where: { id: activity.id } }).catch(() => undefined);
    if (err instanceof ConnectionUnavailableError) throw err;
    throw new ValidationError(err instanceof OAuthTransientError ? `The meeting was not created: ${err.message}` : "The meeting was not created. Try again in a moment.");
  }
  if (input.withVideo && !event.joinUrl) {
    // Asked for a link and the provider gave none: say so rather than invite people to a meeting nobody can join.
    await getCalendarProvider(connection.provider as OAuthProviderKey).then(async (p) => p.cancelEvent((await getAccessToken(ctx.organizationId, connection.id)).token, settings.calendarId, event.id)).catch(() => undefined);
    await adminDb.activity.delete({ where: { id: activity.id } }).catch(() => undefined);
    throw new ValidationError("The calendar did not create a video link, so the meeting was not scheduled.", [{ path: "withVideo", message: "Try again, or schedule without a link." }]);
  }
  const communication = await createCommunicationRecord({
    organizationId: ctx.organizationId,
    channel: "MEETING",
    direction: "OUTBOUND",
    occurredAt: start,
    subject: title,
    summary: `Meeting scheduled for ${start.toISOString()}${event.joinUrl ? ` with a video link` : ""}.`,
    externalReference: `event:${connection.id}:${event.id}`,
    authorMembershipId: ctx.membershipId,
    activityId: activity.id,
    ...ids,
  });
  const link = await adminDb.calendarEventLink.create({
    data: {
      organizationId: ctx.organizationId,
      connectionId: connection.id,
      membershipId: connection.membershipId,
      calendarId: settings.calendarId,
      externalEventId: event.id,
      externalEtag: event.etag,
      source: "CRM",
      activityId: activity.id,
      communicationId: communication.id,
      title,
      startsAt: start,
      endsAt: end,
      joinUrl: event.joinUrl,
      attendees,
      lastSyncedAt: new Date(),
    },
  });
  let followUpTaskId: string | null = null;
  if (input.followUp?.title) {
    const task = await createTask(ctx, { title: input.followUp.title, dueAt: input.followUp.dueAt ?? end.toISOString(), ...ids });
    followUpTaskId = task.id;
  }
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "meeting.scheduled",
    entityType: "Activity",
    entityId: activity.id,
    metadata: { provider: connection.provider, attendees: attendees.length, video: !!event.joinUrl },
  });
  return { ...meetingView(link, activity.id), followUpTaskId };
}

async function loadMeeting(ctx: AuthContext, activityId: string) {
  const link = await adminDb.calendarEventLink.findFirst({ where: { organizationId: ctx.organizationId, activityId } });
  if (!link) throw new NotFoundError("Meeting", activityId);
  const activity = await adminDb.activity.findFirst({ where: { id: activityId, organizationId: ctx.organizationId } });
  if (!activity) throw new NotFoundError("Meeting", activityId);
  // The person must be able to open the record, and only the organiser (or Management) changes the event.
  await assertCanAccessLinkedRecords(ctx, { companyId: activity.companyId ?? undefined, contactId: activity.contactId ?? undefined, leadId: activity.leadId ?? undefined, dealId: activity.dealId ?? undefined }, { requireWritable: true });
  if (link.membershipId !== ctx.membershipId && !hasPermission(ctx, "configuration.manage")) throw new NotFoundError("Meeting", activityId);
  return { link, activity };
}

export async function rescheduleMeeting(ctx: AuthContext, activityId: string, patch: { start?: string; end?: string; title?: string }) {
  requirePermission(ctx, "activities.create");
  const { link, activity } = await loadMeeting(ctx, activityId);
  if (link.status === "CANCELLED") throw new ValidationError("This meeting was cancelled.", [{ path: "status", message: "Schedule a new one." }]);
  const start = patch.start ? new Date(patch.start) : (link.startsAt ?? activity.occurredAt);
  const end = patch.end ? new Date(patch.end) : patch.start ? new Date(start.getTime() + ((link.endsAt?.getTime() ?? start.getTime() + 1_800_000) - (link.startsAt?.getTime() ?? start.getTime()))) : (link.endsAt ?? new Date(start.getTime() + 1_800_000));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new ValidationError("The new time is not valid.", [{ path: "start", message: "Pick a start and an end after it." }]);
  const title = patch.title?.trim() || link.title;
  const connection = await getUsableConnection(ctx.organizationId, link.connectionId);
  const { token } = await getAccessToken(ctx.organizationId, connection.id);
  const provider = await getCalendarProvider(connection.provider as OAuthProviderKey);
  const event = await provider.updateEvent(token, link.calendarId, link.externalEventId, { title, start, end });
  await adminDb.activity.update({ where: { id: activityId }, data: { occurredAt: start, subject: title } });
  const updated = await adminDb.calendarEventLink.update({ where: { id: link.id }, data: { title, startsAt: start, endsAt: end, externalEtag: event.etag, joinUrl: event.joinUrl ?? link.joinUrl, lastSyncedAt: new Date() } });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "meeting.rescheduled", entityType: "Activity", entityId: activityId, metadata: { start: start.toISOString() } });
  return meetingView(updated, activityId);
}

export async function cancelMeeting(ctx: AuthContext, activityId: string) {
  requirePermission(ctx, "activities.create");
  const { link } = await loadMeeting(ctx, activityId);
  if (link.status === "CANCELLED") return meetingView(link, activityId);
  const connection = await getUsableConnection(ctx.organizationId, link.connectionId);
  const { token } = await getAccessToken(ctx.organizationId, connection.id);
  await (await getCalendarProvider(connection.provider as OAuthProviderKey)).cancelEvent(token, link.calendarId, link.externalEventId);
  await adminDb.activity.update({ where: { id: activityId }, data: { outcome: "Cancelled" } });
  const updated = await adminDb.calendarEventLink.update({ where: { id: link.id }, data: { status: "CANCELLED", lastSyncedAt: new Date() } });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "meeting.cancelled", entityType: "Activity", entityId: activityId });
  return meetingView(updated, activityId);
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export async function syncCalendar(organizationId: string, connectionId: string) {
  const result = { fetched: 0, created: 0, updated: 0, cancelled: 0, ignored: 0, unchanged: 0, tasksPushed: 0 };
  const connection = await getUsableConnection(organizationId, connectionId);
  if (connection.kind !== "CALENDAR") throw new ValidationError("That is not a calendar connection.");
  const settings = readCalendarSettings(connection);
  if (!settings.syncEnabled) return { ...result, skipped: "SYNC_OFF" as const };
  try {
    const { token } = await getAccessToken(organizationId, connectionId);
    const provider = await getCalendarProvider(connection.provider as OAuthProviderKey);
    const since = connection.syncCursor ? new Date(new Date(connection.syncCursor).getTime() - 60_000) : new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000);
    const events = await provider.listEvents(token, settings.calendarId, { updatedSince: since, limit: SYNC_BATCH });
    result.fetched = events.length;
    let newest = connection.syncCursor ? new Date(connection.syncCursor) : since;
    for (const event of events) {
      if (event.updatedAt > newest) newest = event.updatedAt;
      const link = await adminDb.calendarEventLink.findUnique({ where: { connectionId_externalEventId: { connectionId, externalEventId: event.id } } });
      if (link) {
        const out = await applyToLink(organizationId, link, event);
        result[out] += 1;
        continue;
      }
      if (event.status === "cancelled") {
        result.ignored += 1;
        continue;
      }
      // A new event: it becomes a meeting only when a known contact is among the attendees.
      const owner = connection.membershipId;
      let contact: Awaited<ReturnType<typeof findContactByEmail>> = null;
      for (const address of event.attendees.filter((a) => a !== connection.accountEmail)) {
        contact = await findContactByEmail(organizationId, address);
        if (contact) break;
      }
      if (!contact || !owner) {
        result.ignored += 1;
        continue;
      }
      const activity = await adminDb.activity.create({
        data: { organizationId, type: "MEETING", subject: event.title || "Meeting", description: event.description, occurredAt: event.start, authorMembershipId: owner, contactId: contact.id, companyId: contact.companyId },
      });
      const communication = await createCommunicationRecord({
        organizationId,
        channel: "MEETING",
        direction: "INBOUND",
        occurredAt: event.start,
        subject: event.title || "Meeting",
        summary: `Meeting from the calendar, ${event.start.toISOString()}.`,
        externalReference: `event:${connectionId}:${event.id}`,
        authorMembershipId: owner,
        activityId: activity.id,
        contactId: contact.id,
        companyId: contact.companyId ?? undefined,
      });
      await adminDb.calendarEventLink.create({
        data: { organizationId, connectionId, membershipId: connection.membershipId, calendarId: settings.calendarId, externalEventId: event.id, externalEtag: event.etag, source: "PROVIDER", activityId: activity.id, communicationId: communication.id, title: event.title, startsAt: event.start, endsAt: event.end, joinUrl: event.joinUrl, attendees: event.attendees, status: "CONFIRMED", lastSyncedAt: new Date() },
      });
      result.created += 1;
    }
    if (settings.syncTasks && connection.membershipId) result.tasksPushed = await pushTasks(organizationId, connection, settings, token);
    await recordSyncResult(connectionId, { ok: true, cursor: newest.toISOString() });
    return result;
  } catch (err) {
    if (err instanceof ConnectionUnavailableError) throw err;
    await recordSyncResult(connectionId, { ok: false, message: err instanceof OAuthTransientError ? err.message : "The calendar could not be read. It will be tried again." });
    throw err;
  }
}

/** Applies a provider change to a paired activity. An event that did not change since the last sync is left alone, so nothing churns. */
async function applyToLink(organizationId: string, link: CalendarEventLink, event: ProviderEvent): Promise<"updated" | "cancelled" | "unchanged"> {
  if (event.status === "cancelled") {
    if (link.status === "CANCELLED") return "unchanged";
    await adminDb.calendarEventLink.update({ where: { id: link.id }, data: { status: "CANCELLED", lastSyncedAt: new Date() } });
    if (link.activityId) await adminDb.activity.updateMany({ where: { id: link.activityId, organizationId }, data: { outcome: "Cancelled" } });
    if (link.taskId) await adminDb.task.updateMany({ where: { id: link.taskId, organizationId, status: { in: ["PENDING", "IN_PROGRESS"] } }, data: { status: "CANCELLED" } });
    return "cancelled";
  }
  const sameTime = link.startsAt?.getTime() === event.start.getTime() && link.endsAt?.getTime() === event.end.getTime();
  if (link.externalEtag === event.etag && sameTime && link.title === event.title && link.status === "CONFIRMED") return "unchanged";
  if (link.source === "TASK") {
    // A task's event moved in the calendar: the task's due time follows.
    if (link.taskId && !sameTime) await adminDb.task.updateMany({ where: { id: link.taskId, organizationId }, data: { dueAt: event.start } });
  } else if (link.activityId) {
    await adminDb.activity.updateMany({ where: { id: link.activityId, organizationId }, data: { occurredAt: event.start, subject: event.title || "Meeting", outcome: link.status === "CANCELLED" ? null : undefined } });
  }
  await adminDb.calendarEventLink.update({
    where: { id: link.id },
    data: { externalEtag: event.etag, title: event.title, startsAt: event.start, endsAt: event.end, attendees: event.attendees, joinUrl: event.joinUrl ?? link.joinUrl, status: "CONFIRMED", lastSyncedAt: new Date() },
  });
  return "updated";
}

/** Two-way only: tasks due soon appear in the calendar, and a finished task's event is cancelled. Never touches tasks of other people. */
async function pushTasks(organizationId: string, connection: OAuthConnection, settings: CalendarSettings, token: string): Promise<number> {
  const provider = await getCalendarProvider(connection.provider as OAuthProviderKey);
  const horizon = new Date(Date.now() + 30 * 86_400_000);
  const tasks = await adminDb.task.findMany({
    where: { organizationId, assigneeMembershipId: connection.membershipId!, status: { in: ["PENDING", "IN_PROGRESS"] }, dueAt: { not: null, lte: horizon, gte: new Date(Date.now() - 86_400_000) } },
    take: 100,
  });
  let pushed = 0;
  for (const task of tasks) {
    const existing = await adminDb.calendarEventLink.findFirst({ where: { connectionId: connection.id, taskId: task.id } });
    const start = task.dueAt!;
    const end = new Date(start.getTime() + 30 * 60_000);
    if (!existing) {
      const event = await provider.createEvent(token, settings.calendarId, { title: `Task: ${task.title}`, start, end, attendees: [], requestId: task.id });
      await adminDb.calendarEventLink.create({ data: { organizationId, connectionId: connection.id, membershipId: connection.membershipId, calendarId: settings.calendarId, externalEventId: event.id, externalEtag: event.etag, source: "TASK", taskId: task.id, title: `Task: ${task.title}`, startsAt: start, endsAt: end, lastSyncedAt: new Date() } });
      pushed += 1;
    } else if (existing.status === "CONFIRMED" && existing.startsAt?.getTime() !== start.getTime() && existing.lastSyncedAt && task.updatedAt > existing.lastSyncedAt) {
      const event = await provider.updateEvent(token, settings.calendarId, existing.externalEventId, { start, end });
      await adminDb.calendarEventLink.update({ where: { id: existing.id }, data: { startsAt: start, endsAt: end, externalEtag: event.etag, lastSyncedAt: new Date() } });
    }
  }
  const done = await adminDb.calendarEventLink.findMany({ where: { connectionId: connection.id, source: "TASK", status: "CONFIRMED" } });
  for (const link of done) {
    const task = link.taskId ? await adminDb.task.findFirst({ where: { id: link.taskId, organizationId }, select: { status: true } }) : null;
    if (!task || task.status === "COMPLETED" || task.status === "CANCELLED") {
      await provider.cancelEvent(token, link.calendarId, link.externalEventId).catch(() => undefined);
      await adminDb.calendarEventLink.update({ where: { id: link.id }, data: { status: "CANCELLED", lastSyncedAt: new Date() } });
    }
  }
  return pushed;
}

export async function syncAllCalendars(organizationId: string) {
  const rows = await adminDb.oAuthConnection.findMany({ where: { organizationId, kind: "CALENDAR", status: "CONNECTED", revokedAt: null }, select: { id: true } });
  const totals = { connections: rows.length, created: 0, failed: 0 };
  for (const r of rows) {
    try {
      totals.created += (await syncCalendar(organizationId, r.id)).created;
    } catch {
      totals.failed += 1;
    }
  }
  return totals;
}

