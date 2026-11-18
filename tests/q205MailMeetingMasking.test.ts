/**
 * Q2.05 (FIG-1386): gaps found in the Communication group audit (docs/Q2_05_COMMUNICATION_QA.md).
 * Mail and meeting entries on deal timelines and the mail record card for every role, and the mail and calendar
 * sync, send and meeting paths called with another organisation's ids. Fake values only.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { ForbiddenError, NotFoundError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { setCalendarProviderFactory, type CalendarProviderClient, type EventInput, type ProviderEvent } from "../src/integrations/calendar/types";
import { setMailProviderFactory, type MailProviderClient, type OutgoingMail, type ProviderMail } from "../src/integrations/mail/types";
import { setOAuthProviderFactory } from "../src/integrations/oauth/providers";
import type { OAuthProviderClient } from "../src/integrations/oauth/types";
import { listCommunicationsForContact, listCommunicationsForDeal } from "../src/services/communicationService";
import { createContact } from "../src/services/contactService";
import { createDraft, getMailRecordCard, runScheduledSend, scheduleDraft, sendDraft, syncMailbox } from "../src/services/mailService";
import { cancelMeeting, rescheduleMeeting, scheduleMeeting, syncCalendar } from "../src/services/meetingService";
import { completeConnection, startConnection } from "../src/services/oauthConnectionService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";
import { createWonDeal } from "./helpers/stage3";

class FakeMail implements MailProviderClient {
  inbox: ProviderMail[] = [];
  sent: OutgoingMail[] = [];
  async listMessages(_t: string, o: { since: Date; limit: number }) {
    return this.inbox.filter((m) => m.receivedAt >= o.since).slice(0, o.limit);
  }
  async sendMessage(_t: string, m: OutgoingMail) {
    this.sent.push(m);
    return { externalId: `ext-${this.sent.length}`, internetMessageId: `<q205-${this.sent.length}@fake.test>` };
  }
}

class FakeCalendar implements CalendarProviderClient {
  events = new Map<string, ProviderEvent>();
  calls: string[] = [];
  async listCalendars() {
    return [{ id: "primary", name: "Main", primary: true }];
  }
  async listEvents(_t: string, _c: string, o: { updatedSince: Date; limit: number }) {
    return [...this.events.values()].filter((e) => e.updatedAt >= o.updatedSince);
  }
  async createEvent(_t: string, _c: string, input: EventInput) {
    this.calls.push("create");
    const e: ProviderEvent = { id: `ev-${randomUUID().slice(0, 8)}`, etag: "1", title: input.title, description: input.description ?? null, start: input.start, end: input.end, attendees: input.attendees, organizerEmail: "me@mine.test", status: "confirmed", joinUrl: null, updatedAt: new Date() };
    this.events.set(e.id, e);
    return e;
  }
  async updateEvent(_t: string, _c: string, id: string, patch: Partial<EventInput>) {
    this.calls.push("update");
    const cur = this.events.get(id)!;
    const next = { ...cur, ...(patch.title !== undefined ? { title: patch.title } : {}), updatedAt: new Date() } as ProviderEvent;
    this.events.set(id, next);
    return next;
  }
  async cancelEvent(_t: string, _c: string, id: string) {
    this.calls.push("cancel");
    const cur = this.events.get(id);
    if (cur) this.events.set(id, { ...cur, status: "cancelled", updatedAt: new Date() });
  }
}

const oauthFake: OAuthProviderClient = {
  key: "GOOGLE",
  buildAuthorizationUrl: (r) => `https://fake.test/auth?state=${r.state}`,
  exchangeCode: async () => ({ accessToken: "fake-access", refreshToken: "fake-refresh", expiresInSeconds: 3600, accountEmail: "me@mine.test" }),
  refresh: async () => ({ accessToken: "fake-access-2", refreshToken: null, expiresInSeconds: 3600 }),
  revoke: async () => undefined,
};

let mail: FakeMail;
let cal: FakeCalendar;
const previousKey = process.env.INTEGRATION_ENCRYPTION_KEY;
const ORIGINAL_RELEASE = process.env.ACTIVE_RELEASE;
beforeAll(() => {
  process.env.ACTIVE_RELEASE = "v1.1";
  process.env.INTEGRATION_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});
afterAll(() => {
  setMailProviderFactory(null);
  setCalendarProviderFactory(null);
  setOAuthProviderFactory(null);
  if (ORIGINAL_RELEASE === undefined) delete process.env.ACTIVE_RELEASE;
  else process.env.ACTIVE_RELEASE = ORIGINAL_RELEASE;
  if (previousKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
  else process.env.INTEGRATION_ENCRYPTION_KEY = previousKey;
});
beforeEach(() => {
  mail = new FakeMail();
  cal = new FakeCalendar();
  setMailProviderFactory(() => mail);
  setCalendarProviderFactory(() => cal);
  setOAuthProviderFactory(() => oauthFake);
});

async function connect(ctx: AuthContext, kind: "EMAIL" | "CALENDAR") {
  const started = await startConnection(ctx, { kind, provider: "GOOGLE" });
  return completeConnection(ctx, { state: new URL(started.authorizationUrl).searchParams.get("state")!, code: "c" });
}

async function world(prefix: string) {
  const org = await createTestOrganization(prefix);
  const management = await createTestContext(org.id, "MANAGEMENT", `${prefix}.m`);
  const sales = await createTestContext(org.id, "SALES", `${prefix}.s`);
  const delivery = await createTestContext(org.id, "DELIVERY", `${prefix}.d`);
  const finance = await createTestContext(org.id, "FINANCE", `${prefix}.f`);
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL", `${prefix}.t`);
  const { contact } = await createContact(sales, { firstName: "Jane", lastName: "Known", email: "jane@client.test" });
  return { org, management, sales, delivery, finance, technical, contact };
}

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

describe("Q2.05 mail and meeting entries: who may open the record, who may see the figures", () => {
  it("a deal's mail and meeting entries are refused to roles that cannot open the deal, and the mail record card carries no figure for Delivery", async () => {
    const w = await world("Q205Tl");
    const deal = await createWonDeal(w.org.id, w.sales, { value: 7654321 });
    await connect(w.sales, "CALENDAR");
    await scheduleMeeting(w.sales, { title: "Kick-off", start: tomorrow(), link: { type: "Deal", id: deal.id } });

    // Management sees the meeting entry on the deal.
    expect(JSON.stringify(await listCommunicationsForDeal(w.management, deal.id))).toContain("Kick-off");
    // A Sales colleague who is not the owner and Restricted Technical cannot open the deal timeline at all.
    const colleague = await createTestContext(w.org.id, "SALES", "Q205Tl.s2");
    for (const ctx of [colleague, w.technical]) {
      await expect(listCommunicationsForDeal(ctx, deal.id)).rejects.toSatisfy((e: unknown) => e instanceof NotFoundError || e instanceof ForbiddenError);
    }
    // The mail record card says "masked" to a role that may not see value, margin or payments, and carries no figure.
    const asDelivery = await getMailRecordCard(w.delivery, { dealId: deal.id });
    expect(JSON.stringify(asDelivery)).not.toContain("7654321");
    expect(asDelivery).toMatchObject({ valueMasked: true, marginMasked: true, paymentsMasked: true });
    // Finance has no mail.use: the card is refused with the explained no-access, it is not shown with figures.
    await expect(getMailRecordCard(w.finance, { dealId: deal.id })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a synced mail shows on the contact timeline, and not to someone without communications.view", async () => {
    const w = await world("Q205View");
    await connect(w.sales, "EMAIL");
    mail.inbox = [{ id: "q1", internetMessageId: "<q1@fake.test>", from: { email: "jane@client.test", name: "Jane" }, to: ["me@mine.test"], cc: [], subject: "Hello", bodyText: "Hi", receivedAt: new Date(), sent: false }];
    const conn = await adminDb.oAuthConnection.findFirstOrThrow({ where: { organizationId: w.org.id, kind: "EMAIL" } });
    await syncMailbox(w.org.id, conn.id);
    expect((await listCommunicationsForContact(w.sales, w.contact.id)).length).toBe(1);
    const noView = { ...w.sales, permissionKeys: w.sales.permissionKeys.filter((k) => k !== "communications.view") } as AuthContext;
    await expect(listCommunicationsForContact(noView, w.contact.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Q2.05 mail and calendar paths called with another organisation's ids", () => {
  async function two() {
    const a = await world("Q205A");
    const b = await world("Q205B");
    await connect(b.sales, "EMAIL");
    await connect(b.sales, "CALENDAR");
    const bMailConn = await adminDb.oAuthConnection.findFirstOrThrow({ where: { organizationId: b.org.id, kind: "EMAIL" } });
    const bCalConn = await adminDb.oAuthConnection.findFirstOrThrow({ where: { organizationId: b.org.id, kind: "CALENDAR" } });
    const bDraft = await createDraft(b.sales, { to: ["jane@client.test"], subject: "B only", body: "x", contactId: b.contact.id });
    const bScheduled = await createDraft(b.sales, { to: ["jane@client.test"], subject: "B later", body: "x", contactId: b.contact.id });
    await scheduleDraft(b.sales, bScheduled.id, new Date(Date.now() + 3_600_000));
    const bDeal = await createWonDeal(b.org.id, b.sales, { value: 100 });
    return { a, b, bMailConn, bCalConn, bDraft, bScheduled, bDeal };
  }

  it("syncs, sends and schedules nothing of B's from A, and changes nothing of B's", { timeout: 120_000 }, async () => {
    const t = await two();
    mail.inbox = [{ id: "x1", internetMessageId: "<x1@fake.test>", from: { email: "jane@client.test" }, to: ["me@mine.test"], cc: [], subject: "Planted", bodyText: "x", receivedAt: new Date(), sent: false }];
    const before = await adminDb.communication.count({ where: { organizationId: t.b.org.id } });

    // Another organisation's connection id, named under A's organisation: nothing is read and nothing is stored.
    await expect(syncMailbox(t.a.org.id, t.bMailConn.id)).rejects.toThrow();
    await expect(syncCalendar(t.a.org.id, t.bCalConn.id)).rejects.toThrow();
    // B's drafts are invisible to A, and A cannot send, or fire the scheduled send of, B's.
    await expect(sendDraft(t.a.sales, t.bDraft.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await runScheduledSend(t.a.org.id, t.bScheduled.id)).toMatchObject({ sent: false });
    expect(mail.sent).toHaveLength(0);
    expect((await adminDb.mailDraft.findUniqueOrThrow({ where: { id: t.bScheduled.id } })).status).toBe("SCHEDULED");
    expect((await adminDb.mailDraft.findUniqueOrThrow({ where: { id: t.bDraft.id } })).status).toBe("DRAFT");
    // A's record card and meeting calls for B's deal find nothing.
    await expect(getMailRecordCard(t.a.management, { dealId: t.bDeal.id })).rejects.toBeInstanceOf(NotFoundError);
    await connect(t.a.sales, "CALENDAR");
    await expect(scheduleMeeting(t.a.sales, { title: "Planted", start: tomorrow(), link: { type: "Deal", id: t.bDeal.id } })).rejects.toSatisfy((e: unknown) => e instanceof NotFoundError || e instanceof ForbiddenError);
    expect(cal.calls).not.toContain("create");
    expect(await adminDb.communication.count({ where: { organizationId: t.b.org.id } })).toBe(before);
    expect(await adminDb.communication.count({ where: { organizationId: t.a.org.id, subject: "Planted" } })).toBe(0);
  });

  it("refuses A to reschedule or cancel B's meeting", { timeout: 120_000 }, async () => {
    const t = await two();
    const meeting = await scheduleMeeting(t.b.sales, { title: "B meeting", start: tomorrow(), link: { type: "Contact", id: t.b.contact.id } });
    const id = meeting.activityId!;
    const calls = cal.calls.length;
    await expect(rescheduleMeeting(t.a.management, id, { title: "Hijacked" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelMeeting(t.a.management, id)).rejects.toBeInstanceOf(NotFoundError);
    expect(cal.calls.length).toBe(calls);
    expect((await adminDb.activity.findUniqueOrThrow({ where: { id } })).subject).toBe("B meeting");
  });
});
