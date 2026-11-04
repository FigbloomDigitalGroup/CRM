import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { getUnscopedAppClientForTests, withOrgContext } from "../src/db/orgScopedClient";
import { createCalendarProvider } from "../src/integrations/calendar/providers";
import { setCalendarProviderFactory, type CalendarProviderClient, type EventInput, type ProviderCalendar, type ProviderEvent } from "../src/integrations/calendar/types";
import { setOAuthProviderFactory } from "../src/integrations/oauth/providers";
import type { OAuthProviderClient } from "../src/integrations/oauth/types";
import { enqueueAndRunNow } from "../src/jobs/runner";
import { createContact } from "../src/services/contactService";
import { cancelMeeting, listProviderCalendars, rescheduleMeeting, scheduleMeeting, syncCalendar } from "../src/services/meetingService";
import { ConnectionUnavailableError, completeConnection, disconnectConnection, startConnection, updateConnectionSettings } from "../src/services/oauthConnectionService";
import { createTask, updateTask } from "../src/services/taskService";
import { createTestContext, createTestOrganization, getLeadStatusId } from "./helpers/fixtures";

// Fake values only.
class FakeCalendar implements CalendarProviderClient {
  events = new Map<string, ProviderEvent>();
  calls: string[] = [];
  noVideoLink = false;
  failCreate = false;
  calendars: ProviderCalendar[] = [
    { id: "primary", name: "Main", primary: true },
    { id: "team", name: "Team", primary: false },
  ];
  lastCalendarId = "";
  async listCalendars() {
    return this.calendars;
  }
  async listEvents(_t: string, calendarId: string, o: { updatedSince: Date; limit: number }) {
    this.lastCalendarId = calendarId;
    return [...this.events.values()].filter((e) => e.updatedAt >= o.updatedSince);
  }
  async createEvent(_t: string, calendarId: string, input: EventInput) {
    this.calls.push("create");
    this.lastCalendarId = calendarId;
    if (this.failCreate) throw new Error("provider down");
    const event: ProviderEvent = {
      id: `ev-${randomUUID().slice(0, 8)}`,
      etag: "1",
      title: input.title,
      description: input.description ?? null,
      start: input.start,
      end: input.end,
      attendees: input.attendees,
      organizerEmail: "me@mine.test",
      status: "confirmed",
      joinUrl: input.withVideo && !this.noVideoLink ? "https://meet.fake.test/abc-defg" : null,
      updatedAt: new Date(),
    };
    this.events.set(event.id, event);
    return event;
  }
  async updateEvent(_t: string, _c: string, id: string, patch: Partial<EventInput>) {
    this.calls.push("update");
    const cur = this.events.get(id)!;
    const next: ProviderEvent = { ...cur, ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.start ? { start: patch.start } : {}), ...(patch.end ? { end: patch.end } : {}), etag: String(Number(cur.etag) + 1), updatedAt: new Date() };
    this.events.set(id, next);
    return next;
  }
  async cancelEvent(_t: string, _c: string, id: string) {
    this.calls.push("cancel");
    const cur = this.events.get(id);
    if (cur) this.events.set(id, { ...cur, status: "cancelled", etag: String(Number(cur.etag) + 1), updatedAt: new Date() });
  }
  /** What someone does in the calendar app itself. */
  external(over: Partial<ProviderEvent> & { id: string }): ProviderEvent {
    const base: Omit<ProviderEvent, "id"> = { etag: "1", title: "Intro call", description: null, start: new Date(Date.now() + 86_400_000), end: new Date(Date.now() + 86_400_000 + 1_800_000), attendees: [], organizerEmail: "me@mine.test", status: "confirmed", joinUrl: null, updatedAt: new Date() };
    const e = { ...base, ...over };
    this.events.set(e.id, e);
    return e;
  }
}

const oauthFake: OAuthProviderClient = {
  key: "GOOGLE",
  buildAuthorizationUrl: (r) => `https://fake.test/auth?state=${r.state}`,
  exchangeCode: async () => ({ accessToken: "fake-access", refreshToken: "fake-refresh", expiresInSeconds: 3600, accountEmail: "me@mine.test" }),
  refresh: async () => ({ accessToken: "fake-access-2", refreshToken: null, expiresInSeconds: 3600 }),
  revoke: async () => undefined,
};

let cal: FakeCalendar;
const previousKey = process.env.INTEGRATION_ENCRYPTION_KEY;
// These are V1.1 features: the test organisations run on release V1.1 (the V1 refusal is tested in releaseGateV11.test.ts).
const ORIGINAL_RELEASE = process.env.ACTIVE_RELEASE;
beforeAll(() => {
  process.env.ACTIVE_RELEASE = "v1.1";
});
afterAll(() => {
  if (ORIGINAL_RELEASE === undefined) delete process.env.ACTIVE_RELEASE;
  else process.env.ACTIVE_RELEASE = ORIGINAL_RELEASE;
});
beforeAll(() => {
  process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});
afterAll(() => {
  setCalendarProviderFactory(null);
  setOAuthProviderFactory(null);
  if (previousKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
  else process.env.INTEGRATION_ENCRYPTION_KEY = previousKey;
});
beforeEach(() => {
  cal = new FakeCalendar();
  setCalendarProviderFactory(() => cal);
  setOAuthProviderFactory(() => oauthFake);
});

async function connectCalendar(ctx: AuthContext) {
  const started = await startConnection(ctx, { kind: "CALENDAR", provider: "GOOGLE" });
  return completeConnection(ctx, { state: new URL(started.authorizationUrl).searchParams.get("state")!, code: "c" });
}

async function setup() {
  const org = await createTestOrganization("Meet");
  const management = await createTestContext(org.id, "MANAGEMENT", "meet.mgmt");
  const sales = await createTestContext(org.id, "SALES", "meet.sales");
  const { contact } = await createContact(sales, { firstName: "Jane", lastName: "Known", email: "jane@client.test" });
  const lead = await adminDb.lead.create({ data: { organizationId: org.id, leadStatusId: await getLeadStatusId(org.id), ownerMembershipId: sales.membershipId, contactId: contact.id } });
  return { org, management, sales, contact, lead };
}

const inOneDay = () => new Date(Date.now() + 86_400_000).toISOString();

describe("scheduling a meeting from a record (FIG-808)", () => {
  it("creates the event with the invite and a video link, returns the join link, and logs the meeting once", async () => {
    const { org, sales, contact, lead } = await setup();
    await connectCalendar(sales);
    const out = await scheduleMeeting(sales, { title: "Discovery call", start: inOneDay(), withVideo: true, attendees: ["Colleague@Client.test"], link: { type: "Lead", id: lead.id }, followUp: { title: "Send notes" } });
    expect(out.joinUrl).toBe("https://meet.fake.test/abc-defg");
    // The record's contact is invited without typing the address; the extra address is cleaned.
    expect(out.attendees.sort()).toEqual(["colleague@client.test", "jane@client.test"]);
    const activity = await adminDb.activity.findUniqueOrThrow({ where: { id: out.activityId! } });
    expect(activity).toMatchObject({ type: "MEETING", subject: "Discovery call", leadId: lead.id, authorMembershipId: sales.membershipId });
    const comms = await adminDb.communication.findMany({ where: { organizationId: org.id, channel: "MEETING" } });
    expect(comms).toHaveLength(1);
    expect(comms[0]).toMatchObject({ activityId: activity.id, leadId: lead.id, subject: "Discovery call" });
    const task = await adminDb.task.findUniqueOrThrow({ where: { id: out.followUpTaskId! } });
    expect(task).toMatchObject({ title: "Send notes", leadId: lead.id });
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "meeting.scheduled" } })).toBe(1);
    void contact;
    expect(cal.events.size).toBe(1);
  });

  it("uses the calendar the person chose, and only one the provider lists", async () => {
    const { sales, lead } = await setup();
    const conn = await connectCalendar(sales);
    expect((await listProviderCalendars(sales, conn.id!)).items.map((c) => c.id)).toEqual(["primary", "team"]);
    await updateConnectionSettings(sales, conn.id!, { calendarId: "team" });
    await scheduleMeeting(sales, { title: "Team room", start: inOneDay(), link: { type: "Lead", id: lead.id } });
    expect(cal.lastCalendarId).toBe("team");
  });

  it("says the calendar is disconnected and creates nothing, and rolls back when the provider fails", async () => {
    const { org, sales, lead } = await setup();
    await expect(scheduleMeeting(sales, { title: "No calendar", start: inOneDay(), link: { type: "Lead", id: lead.id } })).rejects.toBeInstanceOf(ConnectionUnavailableError);
    expect(await adminDb.activity.count({ where: { organizationId: org.id, type: "MEETING" } })).toBe(0);
    await connectCalendar(sales);
    cal.failCreate = true;
    await expect(scheduleMeeting(sales, { title: "Fails", start: inOneDay(), link: { type: "Lead", id: lead.id } })).rejects.toBeInstanceOf(ValidationError);
    expect(await adminDb.activity.count({ where: { organizationId: org.id, type: "MEETING" } })).toBe(0);
    expect(await adminDb.communication.count({ where: { organizationId: org.id, channel: "MEETING" } })).toBe(0);
  });

  it("does not schedule a video meeting that came back with no link", async () => {
    const { org, sales, lead } = await setup();
    await connectCalendar(sales);
    cal.noVideoLink = true;
    await expect(scheduleMeeting(sales, { title: "Linkless", start: inOneDay(), withVideo: true, link: { type: "Lead", id: lead.id } })).rejects.toBeInstanceOf(ValidationError);
    expect(await adminDb.activity.count({ where: { organizationId: org.id, type: "MEETING" } })).toBe(0);
    expect([...cal.events.values()].every((e) => e.status === "cancelled")).toBe(true);
  });

  it("checks the title, the times and the attendee addresses", async () => {
    const { sales, lead } = await setup();
    await connectCalendar(sales);
    const base = { start: inOneDay(), link: { type: "Lead" as const, id: lead.id } };
    await expect(scheduleMeeting(sales, { ...base, title: " " })).rejects.toBeInstanceOf(ValidationError);
    await expect(scheduleMeeting(sales, { ...base, title: "x", start: "soon" })).rejects.toBeInstanceOf(ValidationError);
    await expect(scheduleMeeting(sales, { ...base, title: "x", end: new Date(Date.now() - 1000).toISOString() })).rejects.toBeInstanceOf(ValidationError);
    await expect(scheduleMeeting(sales, { ...base, title: "x", attendees: ["bad address"] })).rejects.toBeInstanceOf(ValidationError);
    await expect(scheduleMeeting(sales, { ...base, title: "x", attendees: Array.from({ length: 51 }, (_, i) => `p${i}@x.test`) })).rejects.toBeInstanceOf(ValidationError);
    expect(cal.calls).toEqual([]);
  });

  it("checks the role and access to the record, across organisations too", async () => {
    const { org, sales, lead, contact } = await setup();
    await connectCalendar(sales);
    const finance = await createTestContext(org.id, "FINANCE", "meet.fin");
    await expect(scheduleMeeting(finance, { title: "x", start: inOneDay(), link: { type: "Lead", id: lead.id } })).rejects.toBeInstanceOf(ForbiddenError);
    const colleague = await createTestContext(org.id, "SALES", "meet.colleague");
    await connectCalendar(colleague);
    await expect(scheduleMeeting(colleague, { title: "x", start: inOneDay(), link: { type: "Lead", id: lead.id } })).rejects.toThrow();
    const other = await createTestOrganization("MeetCross");
    const stranger = await createTestContext(other.id, "SALES", "meet.stranger");
    await connectCalendar(stranger);
    await expect(scheduleMeeting(stranger, { title: "x", start: inOneDay(), link: { type: "Contact", id: contact.id } })).rejects.toThrow();
    expect(cal.calls).toEqual([]);
  });
});

describe("reschedule and cancel (FIG-808)", () => {
  it("changes the event and the activity together, cancels once, and keeps others out", async () => {
    const { org, management, sales, lead } = await setup();
    await connectCalendar(sales);
    const m = await scheduleMeeting(sales, { title: "Review", start: inOneDay(), withVideo: true, link: { type: "Lead", id: lead.id } });
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const moved = await rescheduleMeeting(sales, m.activityId!, { start: later, title: "Review v2" });
    expect(moved.start?.toISOString()).toBe(later);
    expect((await adminDb.activity.findUniqueOrThrow({ where: { id: m.activityId! } })).occurredAt.toISOString()).toBe(later);
    expect([...cal.events.values()][0]).toMatchObject({ title: "Review v2" });
    // Moving keeps the length of the meeting.
    expect(moved.end!.getTime() - moved.start!.getTime()).toBe(1_800_000);

    const colleague = await createTestContext(org.id, "SALES", "meet.colleague");
    await expect(rescheduleMeeting(colleague, m.activityId!, { title: "hijack" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelMeeting(colleague, m.activityId!)).rejects.toBeInstanceOf(NotFoundError);

    const cancelled = await cancelMeeting(sales, m.activityId!);
    expect(cancelled.status).toBe("CANCELLED");
    expect((await adminDb.activity.findUniqueOrThrow({ where: { id: m.activityId! } })).outcome).toBe("Cancelled");
    expect([...cal.events.values()][0]!.status).toBe("cancelled");
    await cancelMeeting(sales, m.activityId!);
    expect(cal.calls.filter((c) => c === "cancel")).toHaveLength(1);
    await expect(rescheduleMeeting(sales, m.activityId!, { start: later })).rejects.toBeInstanceOf(ValidationError);
    // Meetings are logged once: moving and cancelling add no second entry.
    expect(await adminDb.communication.count({ where: { organizationId: org.id, channel: "MEETING" } })).toBe(1);
    void management;
  });

  it("lets Management step in for a meeting someone else organised", async () => {
    const { management, sales, lead } = await setup();
    await connectCalendar(sales);
    const m = await scheduleMeeting(sales, { title: "Boss review", start: inOneDay(), link: { type: "Lead", id: lead.id } });
    expect((await cancelMeeting(management, m.activityId!)).status).toBe("CANCELLED");
  });
});

describe("sync (FIG-808)", () => {
  it("pulls events with known contacts as MEETING activities, once, and ignores the rest", async () => {
    const { org, sales, contact } = await setup();
    const conn = await connectCalendar(sales);
    cal.external({ id: "e-known", title: "Intro call", attendees: ["me@mine.test", "jane@client.test"] });
    cal.external({ id: "e-unknown", title: "Dentist", attendees: ["dentist@clinic.test"] });
    cal.external({ id: "e-gone", title: "Cancelled before we saw it", attendees: ["jane@client.test"], status: "cancelled" });
    const first = await syncCalendar(org.id, conn.id!);
    expect(first).toMatchObject({ fetched: 3, created: 1, ignored: 2 });
    const activity = await adminDb.activity.findFirstOrThrow({ where: { organizationId: org.id, type: "MEETING" } });
    expect(activity).toMatchObject({ subject: "Intro call", contactId: contact.id, authorMembershipId: sales.membershipId });
    expect(await adminDb.communication.count({ where: { organizationId: org.id, channel: "MEETING", contactId: contact.id } })).toBe(1);
    // Syncing again changes nothing.
    const second = await syncCalendar(org.id, conn.id!);
    expect(second.created).toBe(0);
    expect(await adminDb.activity.count({ where: { organizationId: org.id, type: "MEETING" } })).toBe(1);
    expect(await adminDb.communication.count({ where: { organizationId: org.id, channel: "MEETING" } })).toBe(1);
  });

  it("applies updates and cancellations from the calendar without duplicates", async () => {
    const { org, sales } = await setup();
    const conn = await connectCalendar(sales);
    const original = cal.external({ id: "e-1", title: "Kickoff", attendees: ["jane@client.test"] });
    await syncCalendar(org.id, conn.id!);
    const newStart = new Date(original.start.getTime() + 2 * 3_600_000);
    cal.events.set("e-1", { ...original, title: "Kickoff (moved)", start: newStart, end: new Date(newStart.getTime() + 1_800_000), etag: "2", updatedAt: new Date(Date.now() + 1000) });
    expect(await syncCalendar(org.id, conn.id!)).toMatchObject({ updated: 1, created: 0 });
    const activity = await adminDb.activity.findFirstOrThrow({ where: { organizationId: org.id, type: "MEETING" } });
    expect(activity).toMatchObject({ subject: "Kickoff (moved)" });
    expect(activity.occurredAt.toISOString()).toBe(newStart.toISOString());
    cal.events.set("e-1", { ...cal.events.get("e-1")!, status: "cancelled", etag: "3", updatedAt: new Date(Date.now() + 2000) });
    expect(await syncCalendar(org.id, conn.id!)).toMatchObject({ cancelled: 1 });
    expect((await adminDb.activity.findFirstOrThrow({ where: { organizationId: org.id, type: "MEETING" } })).outcome).toBe("Cancelled");
    expect(await adminDb.activity.count({ where: { organizationId: org.id, type: "MEETING" } })).toBe(1);
  });

  it("does not duplicate a meeting the CRM created when it comes back from the calendar", async () => {
    const { org, sales, lead } = await setup();
    const conn = await connectCalendar(sales);
    await scheduleMeeting(sales, { title: "Echo", start: inOneDay(), link: { type: "Lead", id: lead.id } });
    const result = await syncCalendar(org.id, conn.id!);
    expect(result.created).toBe(0);
    expect(await adminDb.activity.count({ where: { organizationId: org.id, type: "MEETING" } })).toBe(1);
    expect(await adminDb.communication.count({ where: { organizationId: org.id, channel: "MEETING" } })).toBe(1);
  });

  it("stops when disconnected", async () => {
    const { org, sales } = await setup();
    const conn = await connectCalendar(sales);
    await disconnectConnection(sales, conn.id!);
    cal.external({ id: "e-late", attendees: ["jane@client.test"] });
    await expect(syncCalendar(org.id, conn.id!)).rejects.toBeInstanceOf(ConnectionUnavailableError);
    expect(await adminDb.activity.count({ where: { organizationId: org.id, type: "MEETING" } })).toBe(0);
  });

  it("puts tasks in the calendar only for two-way sync, once, and cancels the event when the task is done", async () => {
    const { org, sales } = await setup();
    const conn = await connectCalendar(sales);
    const task = await createTask(sales, { title: "Call the client", dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString() });
    expect((await syncCalendar(org.id, conn.id!)).tasksPushed).toBe(0);
    expect(cal.events.size).toBe(0);
    await updateConnectionSettings(sales, conn.id!, { syncTasks: true });
    expect((await syncCalendar(org.id, conn.id!)).tasksPushed).toBe(1);
    expect((await syncCalendar(org.id, conn.id!)).tasksPushed).toBe(0);
    expect([...cal.events.values()].map((e) => e.title)).toEqual(["Task: Call the client"]);
    await updateTask(sales, task.id, { status: "COMPLETED" });
    await syncCalendar(org.id, conn.id!);
    expect([...cal.events.values()][0]!.status).toBe("cancelled");
    // The task's own event coming back is not turned into a meeting.
    expect(await adminDb.activity.count({ where: { organizationId: org.id, type: "MEETING" } })).toBe(0);
  });

  it("runs on the job framework for the organisation's own connections only", async () => {
    const { org, sales } = await setup();
    await connectCalendar(sales);
    cal.external({ id: "e-job", attendees: ["jane@client.test"] });
    const otherOrg = await createTestOrganization("MeetOther");
    const otherSales = await createTestContext(otherOrg.id, "SALES", "meet.other");
    const otherConn = await connectCalendar(otherSales);
    const result = await enqueueAndRunNow({ organizationId: org.id, type: "calendar.sync" });
    expect(result.outcome).toBe("succeeded");
    expect(result.job?.result).toMatchObject({ connections: 1, created: 1, failed: 0 });
    expect((await adminDb.oAuthConnection.findUniqueOrThrow({ where: { id: otherConn.id! } })).lastSyncedAt).toBeNull();
  });
});

describe("real Google and Graph calendar clients (fake provider server)", () => {
  function server(reply: unknown) {
    const seen: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: string, init: RequestInit = {}) => {
      seen.push({ url, init });
      return new Response(JSON.stringify(reply), { status: 200 });
    }) as unknown as typeof fetch;
    return { impl, seen };
  }
  const input: EventInput = { title: "T", start: new Date("2026-12-01T09:00:00Z"), end: new Date("2026-12-01T09:30:00Z"), attendees: ["a@b.test"], withVideo: true, requestId: "req-1" };

  it("asks Google for a Meet link and reads the join link back", async () => {
    const s = server({ id: "g1", etag: "e", summary: "T", start: { dateTime: "2026-12-01T09:00:00Z" }, end: { dateTime: "2026-12-01T09:30:00Z" }, hangoutLink: "https://meet.google.com/xyz", attendees: [{ email: "A@b.test" }], updated: "2026-11-04T00:00:00Z" });
    const event = await createCalendarProvider("GOOGLE", s.impl).createEvent("tok", "primary", input);
    expect(s.seen[0]!.url).toContain("conferenceDataVersion=1");
    expect(s.seen[0]!.url).toContain("sendUpdates=all");
    expect(JSON.parse(String(s.seen[0]!.init.body)).conferenceData.createRequest).toMatchObject({ requestId: "req-1", conferenceSolutionKey: { type: "hangoutsMeet" } });
    expect(event).toMatchObject({ id: "g1", joinUrl: "https://meet.google.com/xyz", attendees: ["a@b.test"] });
  });

  it("asks Graph for a Teams meeting and reads the join link back", async () => {
    const s = server({ id: "m1", subject: "T", start: { dateTime: "2026-12-01T09:00:00.0000000" }, end: { dateTime: "2026-12-01T09:30:00.0000000" }, onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/xyz" }, attendees: [] });
    const event = await createCalendarProvider("MICROSOFT", s.impl).createEvent("tok", "cal-1", input);
    expect(JSON.parse(String(s.seen[0]!.init.body))).toMatchObject({ isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness", transactionId: "req-1" });
    expect(event.joinUrl).toBe("https://teams.microsoft.com/l/meetup-join/xyz");
    expect(event.start.toISOString()).toBe("2026-12-01T09:00:00.000Z");
  });
});

describe("row-level security (mail drafts and calendar links)", () => {
  it("hides one organisation's drafts and event links from another, as the application role", async () => {
    const { org, sales, lead } = await setup();
    const conn = await connectCalendar(sales);
    await scheduleMeeting(sales, { title: "Private", start: inOneDay(), link: { type: "Lead", id: lead.id } });
    await adminDb.mailDraft.create({ data: { organizationId: org.id, membershipId: sales.membershipId, subject: "secret draft" } });
    const other = await createTestOrganization("MeetRls");
    const app = getUnscopedAppClientForTests();
    expect(await app.calendarEventLink.findMany({ where: { organizationId: org.id } })).toHaveLength(0);
    expect(await app.mailDraft.findMany({ where: { organizationId: org.id } })).toHaveLength(0);
    await withOrgContext(other.id, async (tx) => {
      expect(await tx.calendarEventLink.findMany({ where: { organizationId: org.id } })).toHaveLength(0);
      expect(await tx.mailDraft.findMany({ where: { organizationId: org.id } })).toHaveLength(0);
      await expect(tx.calendarEventLink.create({ data: { organizationId: org.id, connectionId: conn.id!, calendarId: "x", externalEventId: "x", source: "CRM" } })).rejects.toThrow();
    });
    await withOrgContext(org.id, async (tx) => {
      expect(await tx.calendarEventLink.count({ where: { organizationId: org.id } })).toBe(1);
      expect(await tx.mailDraft.count({ where: { organizationId: org.id } })).toBe(1);
    });
  });
});

describe("review fixes: meetings.schedule and calendar ownership", () => {
  it("needs meetings.schedule as well as activities.create, and only the owner lists or changes a personal calendar", async () => {
    const { management, sales, lead } = await setup();
    const conn = await connectCalendar(sales);
    const without: AuthContext = { ...sales, permissionKeys: sales.permissionKeys.filter((k) => k !== "meetings.schedule") };
    await expect(scheduleMeeting(without, { title: "x", start: inOneDay(), link: { type: "Lead", id: lead.id } })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(rescheduleMeeting(without, "nope", { title: "y" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(cancelMeeting(without, "nope")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listProviderCalendars(management, conn.id!)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateConnectionSettings(management, conn.id!, { calendarId: "primary" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(listProviderCalendars(sales, conn.id!)).resolves.toBeDefined();
  });
});
