import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { ingestInboundEmail } from "../src/services/inboundEmailService";
import { regenerateInboundEmailKey } from "../src/services/integrationService";
import { createCommunication } from "../src/repositories/communications";
import { listCommunicationsForCompany } from "../src/services/communicationService";
import {
  CONVERSATION_TABS,
  conversationAccess,
  createLeadFromConversation,
  dismissConversation,
  getConversation,
  linkConversation,
  listConversations,
  listNeedsLinking,
  logUnlinkedConversation,
} from "../src/services/conversationService";
import { createTestContext, createTestOrganization, getLeadStatusId, getPipelineStageId } from "./helpers/fixtures";
import { createCompanyRow, createWonDeal, daysFrom } from "./helpers/stage3";

const NOW = new Date("2026-11-10T09:00:00.000Z");

async function setup() {
  const org = await createTestOrganization("Conversations");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const sales = await createTestContext(org.id, "SALES");
  const otherSales = await createTestContext(org.id, "SALES", "other.sales");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const finance = await createTestContext(org.id, "FINANCE");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
  return { org, management, sales, otherSales, delivery, finance, technical };
}

async function issues(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ValidationError) return err.issues ?? [];
    throw err;
  }
  throw new Error("Expected the call to be rejected.");
}

const comm = (organizationId: string, data: Partial<Parameters<typeof createCommunication>[0]> & { summary: string }) =>
  createCommunication({ channel: "EMAIL", direction: "INBOUND", ...data, organizationId });

const waiting = (organizationId: string, extra: Partial<Parameters<typeof createCommunication>[0]> = {}) =>
  comm(organizationId, { summary: "Hello, I would like a quote", subject: "Quote please", needsLinking: true, counterpartyEmail: "new.person@example.test", counterpartyName: "New Person", occurredAt: NOW, ...extra });

describe("the hub list", () => {
  it("merges messages and logged activities by time, with tabs, counts, and a quick-logged call shown once", async () => {
    const { org, management, sales } = await setup();
    const company = await createCompanyRow(org.id, { name: "Hub Ltd", ownerMembershipId: sales.membershipId });
    const at = (n: number) => daysFrom(NOW, -n);
    await comm(org.id, { companyId: company.id, channel: "EMAIL", direction: "INBOUND", subject: "Re: proposal", summary: "Thanks", occurredAt: at(1) });
    await comm(org.id, { companyId: company.id, channel: "WHATSAPP", direction: "OUTBOUND", summary: "Sent the brochure", occurredAt: at(2), authorMembershipId: sales.membershipId });
    await comm(org.id, { companyId: company.id, channel: "MEETING", direction: "OUTBOUND", summary: "Site visit", occurredAt: at(3) });
    const call = await adminDb.activity.create({ data: { organizationId: org.id, companyId: company.id, authorMembershipId: sales.membershipId, type: "CALL", subject: "Call: Reached", occurredAt: at(4) } });
    await comm(org.id, { companyId: company.id, channel: "PHONE", direction: "OUTBOUND", summary: "Call: Reached.", occurredAt: at(4), activityId: call.id });
    await adminDb.activity.create({ data: { organizationId: org.id, companyId: company.id, authorMembershipId: sales.membershipId, type: "NOTE", subject: "Wants Q1 start", occurredAt: at(5) } });
    await adminDb.activity.create({ data: { organizationId: org.id, companyId: company.id, authorMembershipId: sales.membershipId, type: "MEETING", subject: "Kick-off", occurredAt: at(6) } });

    const all = await listConversations(management, {}, {});
    expect(all.items.map((i) => i.subject ?? i.summary)).toEqual(["Re: proposal", "Sent the brochure", "Site visit", "Call: Reached.", "Wants Q1 start", "Kick-off"]);
    expect(all.total).toBe(6); // the call's activity and its communication count once
    expect(all.items.filter((i) => i.channel === "PHONE" || i.channel === "CALL")).toHaveLength(1);
    expect(all.tabCounts).toEqual({ ALL: 6, EMAIL: 1, WHATSAPP: 1, CALLS: 1, MEETINGS: 2, NOTES: 1 });
    for (const tab of CONVERSATION_TABS) expect((await listConversations(management, { tab }, {})).total).toBe(all.tabCounts[tab]);
    expect((await listConversations(management, { tab: "NOTES" }, {})).items[0]).toMatchObject({ kind: "ACTIVITY", subject: "Wants Q1 start" });
    expect((await listConversations(management, { tab: "MEETINGS" }, {})).items.map((i) => i.kind).sort()).toEqual(["ACTIVITY", "COMMUNICATION"]);
    expect(all.items[0]).toMatchObject({ kind: "COMMUNICATION", direction: "INBOUND", link: { companyId: company.id, companyName: "Hub Ltd" }, needsLinking: false });
    const paged = await listConversations(management, {}, { pageSize: 2, page: 2 });
    expect(paged.items).toHaveLength(2);
    expect(paged).toMatchObject({ total: 6, pageCount: 3, page: 2 });
  });

  it("filters by direction, owner, search and dates, and refuses what it does not know", async () => {
    const { org, management, sales, otherSales } = await setup();
    const mine = await createCompanyRow(org.id, { name: "Mine Ltd", ownerMembershipId: sales.membershipId });
    const theirs = await createCompanyRow(org.id, { name: "Theirs Ltd", ownerMembershipId: otherSales.membershipId });
    await comm(org.id, { companyId: mine.id, direction: "INBOUND", subject: "Alpha pricing", summary: "How much for alpha?", occurredAt: daysFrom(NOW, -1) });
    await comm(org.id, { companyId: theirs.id, direction: "OUTBOUND", subject: "Beta", summary: "Sent beta", occurredAt: daysFrom(NOW, -10), authorMembershipId: otherSales.membershipId });
    const subjects = async (f: Parameters<typeof listConversations>[1]) => (await listConversations(management, f, {})).items.map((i) => i.subject);
    expect(await subjects({ direction: "INBOUND" })).toEqual(["Alpha pricing"]);
    expect(await subjects({ direction: "OUTBOUND" })).toEqual(["Beta"]);
    expect(await subjects({ ownerMembershipId: sales.membershipId })).toEqual(["Alpha pricing"]);
    expect(await subjects({ ownerMembershipId: otherSales.membershipId })).toEqual(["Beta"]);
    expect(await subjects({ q: "ALPHA" })).toEqual(["Alpha pricing"]);
    expect(await subjects({ q: "theirs ltd" })).toEqual(["Beta"]);
    expect(await subjects({ from: daysFrom(NOW, -3).toISOString() })).toEqual(["Alpha pricing"]);
    expect(await subjects({ to: daysFrom(NOW, -5).toISOString() })).toEqual(["Beta"]);
    await expect(listConversations(management, { tab: "SPAM" })).rejects.toBeInstanceOf(ValidationError);
    await expect(listConversations(management, { direction: "SIDEWAYS" })).rejects.toBeInstanceOf(ValidationError);
    await expect(listConversations(management, { from: "yesterday-ish" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("never lists a message linked to a record the caller could not open", async () => {
    const { org, management, sales, otherSales, delivery, finance, technical } = await setup();
    const company = await createCompanyRow(org.id, { name: "Shared Ltd", ownerMembershipId: management.membershipId });
    const status = await getLeadStatusId(org.id);
    const myLead = await adminDb.lead.create({ data: { organizationId: org.id, companyId: company.id, leadStatusId: status, ownerMembershipId: sales.membershipId } });
    const theirLead = await adminDb.lead.create({ data: { organizationId: org.id, companyId: company.id, leadStatusId: status, ownerMembershipId: otherSales.membershipId } });
    const openDeal = await adminDb.deal.create({ data: { organizationId: org.id, companyId: company.id, ownerMembershipId: otherSales.membershipId, pipelineStageId: await getPipelineStageId(org.id) } });
    const wonDeal = await createWonDeal(org.id, otherSales, { companyId: company.id });
    const make = async (summary: string, links: Record<string, string>) => (await comm(org.id, { summary, occurredAt: NOW, ...links })).id;
    await make("company only", { companyId: company.id });
    await make("my lead", { leadId: myLead.id, companyId: company.id });
    await make("their lead", { leadId: theirLead.id, companyId: company.id });
    await make("open deal", { dealId: openDeal.id, companyId: company.id });
    await make("won deal", { dealId: wonDeal.id, companyId: company.id });
    await adminDb.activity.create({ data: { organizationId: org.id, leadId: theirLead.id, authorMembershipId: otherSales.membershipId, type: "NOTE", subject: "their private note", occurredAt: NOW } });
    const seen = async (ctx: typeof sales) => (await listConversations(ctx, {}, {})).items.map((i) => i.summary ?? i.subject).sort();

    expect(await seen(management)).toEqual(["company only", "my lead", "open deal", "their lead", "their private note", "won deal"].sort());
    expect(await seen(sales)).toEqual(["company only", "my lead"]);
    expect(await seen(otherSales)).toEqual(["company only", "open deal", "their lead", "their private note", "won deal"]);
    expect(await seen(delivery)).toEqual(["company only", "won deal"]);
    expect(await seen(technical)).toEqual([]); // no company, lead or deal visibility at all
    await expect(listConversations(finance, {}, {})).rejects.toBeInstanceOf(ForbiddenError);
    const salesTotal = (await listConversations(sales, {}, {})).total;
    expect(salesTotal).toBe(2);
    expect((await listConversations(sales, {}, {})).tabCounts.ALL).toBe(2);
    // The same rule holds when asking for one message by id.
    const hidden = await adminDb.communication.findFirstOrThrow({ where: { organizationId: org.id, summary: "their lead" } });
    await expect(getConversation(sales, hidden.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getConversation(otherSales, hidden.id)).id).toBe(hidden.id);
  });
});

describe("the Needs-linking queue", () => {
  it("collects webhook mail from unknown senders, and Delivery may read it but not act, with each attempt audited", async () => {
    const { org, sales, delivery, finance } = await setup();
    const key = await regenerateInboundEmailKey(await createTestContext(org.id, "MANAGEMENT", "keys"));
    await ingestInboundEmail(org.slug, key.token, { from: "Zed <zed@nowhere.test>", subject: "Hello", text: "Do you do CCTV?", messageId: "<q1>" });
    await logUnlinkedConversation(sales, { channel: "PHONE", direction: "INBOUND", summary: "Missed call, left a voicemail", counterpartyPhone: "0712 345 678" });

    const queue = await listNeedsLinking(sales, {}, {});
    expect(queue.total).toBe(2);
    expect(queue.items.map((i) => i.counterparty.email ?? i.counterparty.phone).sort()).toEqual(["0712 345 678", "zed@nowhere.test"]);
    expect(queue.access).toEqual({ canView: true, canAct: true, readOnly: false, notice: null });

    const readOnly = await listNeedsLinking(delivery, {}, {});
    expect(readOnly.total).toBe(2);
    expect(readOnly.access).toMatchObject({ canAct: false, readOnly: true, notice: expect.stringMatching(/read these messages/i) });
    const item = queue.items[0]!;
    const company = await createCompanyRow(org.id);
    await expect(linkConversation(delivery, item.id, { companyId: company.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(dismissConversation(delivery, item.id, { reason: "spam" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createLeadFromConversation(delivery, item.id)).rejects.toBeInstanceOf(ForbiddenError);
    const denied = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: "conversation.action_denied" }, orderBy: { createdAt: "asc" } });
    expect(denied.map((e) => (e.metadata as { attempted: string }).attempted)).toEqual(["link", "dismiss", "create_lead"]);
    expect(denied[0]).toMatchObject({ actorMembershipId: delivery.membershipId, entityId: item.id });
    await expect(listNeedsLinking(finance, {}, {})).rejects.toBeInstanceOf(ForbiddenError);
    expect(conversationAccess({ permissionKeys: [] })).toMatchObject({ canView: false, canAct: false, readOnly: false });
  });

  it("searches the queue, and keeps a waiting message out of the hub list until it is linked", async () => {
    const { org, management } = await setup();
    await waiting(org.id, { subject: "Fence quote", counterpartyEmail: "fence@example.test" });
    await waiting(org.id, { subject: "Solar panels", counterpartyEmail: "solar@example.test" });
    expect((await listNeedsLinking(management, { q: "solar" }, {})).items.map((i) => i.subject)).toEqual(["Solar panels"]);
    expect((await listNeedsLinking(management, { q: "fence@example" }, {})).total).toBe(1);
    expect((await listConversations(management, {}, {})).total).toBe(0);
  });
});

describe("linking", () => {
  it("moves a waiting message onto the record's timeline, is idempotent, and refuses a different record afterwards", async () => {
    const { org, sales, management } = await setup();
    const company = await createCompanyRow(org.id, { name: "Link Ltd", ownerMembershipId: sales.membershipId });
    const other = await createCompanyRow(org.id, { name: "Other Ltd" });
    const w = await waiting(org.id);

    const first = await linkConversation(sales, w.id, { companyId: company.id }, NOW);
    expect(first.alreadyLinked).toBe(false);
    expect(first.item).toMatchObject({ needsLinking: false, link: { companyId: company.id, companyName: "Link Ltd" }, linkedAt: expect.any(Date) });
    expect((await listCommunicationsForCompany(sales, company.id)).map((c) => c.id)).toContain(w.id);
    expect((await listNeedsLinking(sales, {}, {})).total).toBe(0);
    expect((await listConversations(management, {}, {})).items.map((i) => i.id)).toContain(w.id);

    const again = await linkConversation(sales, w.id, { companyId: company.id }, NOW);
    expect(again).toMatchObject({ alreadyLinked: true });
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "communication.linked", entityId: w.id } })).toBe(1);
    expect((await issues(linkConversation(sales, w.id, { companyId: other.id }, NOW)))[0]).toMatchObject({ code: "ALREADY_LINKED" });
    const normal = await comm(org.id, { companyId: company.id, summary: "Already belongs" });
    expect((await issues(linkConversation(sales, normal.id, { companyId: other.id }, NOW)))[0]).toMatchObject({ code: "NOT_IN_QUEUE" });
  });

  it("brings a lead's contact and company with it, a deal's company, and bumps the deal's activity", async () => {
    const { org, sales } = await setup();
    const company = await createCompanyRow(org.id, { ownerMembershipId: sales.membershipId });
    const contact = await adminDb.contact.create({ data: { organizationId: org.id, firstName: "Amani", companyId: company.id } });
    const lead = await adminDb.lead.create({ data: { organizationId: org.id, companyId: company.id, contactId: contact.id, leadStatusId: await getLeadStatusId(org.id), ownerMembershipId: sales.membershipId } });
    const deal = await adminDb.deal.create({ data: { organizationId: org.id, companyId: company.id, ownerMembershipId: sales.membershipId, pipelineStageId: await getPipelineStageId(org.id), lastActivityAt: daysFrom(NOW, -30) } });
    const a = await waiting(org.id);
    const b = await waiting(org.id, { occurredAt: daysFrom(NOW, -2) });
    const viaLead = await linkConversation(sales, a.id, { leadId: lead.id });
    expect(viaLead.item.link).toMatchObject({ leadId: lead.id, contactId: contact.id, companyId: company.id });
    await linkConversation(sales, b.id, { dealId: deal.id });
    expect((await adminDb.deal.findUniqueOrThrow({ where: { id: deal.id } })).lastActivityAt).toEqual(daysFrom(NOW, -2));
    expect((await adminDb.communication.findUniqueOrThrow({ where: { id: b.id } })).companyId).toBe(company.id);
  });

  it("refuses a record the caller cannot open, an archived company, a missing target, and a message that does not exist", async () => {
    const { org, sales, otherSales } = await setup();
    const company = await createCompanyRow(org.id);
    const theirLead = await adminDb.lead.create({ data: { organizationId: org.id, companyId: company.id, leadStatusId: await getLeadStatusId(org.id), ownerMembershipId: otherSales.membershipId } });
    const archived = await createCompanyRow(org.id, { name: "Archived Ltd" });
    await adminDb.company.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    const w = await waiting(org.id);
    await expect(linkConversation(sales, w.id, { leadId: theirLead.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(linkConversation(sales, w.id, { companyId: archived.id })).rejects.toMatchObject({ message: expect.stringMatching(/archived/i) });
    expect((await issues(linkConversation(sales, w.id, {})))[0]).toMatchObject({ path: "leadId" });
    await expect(linkConversation(sales, "00000000-0000-0000-0000-000000000000", { companyId: company.id })).rejects.toBeInstanceOf(NotFoundError);
    expect((await listNeedsLinking(sales, {}, {})).total).toBe(1); // nothing was consumed by the failures
  });

  it("two people linking at once: one wins, and the same record is a success for both", async () => {
    const { org, sales, management } = await setup();
    const company = await createCompanyRow(org.id);
    const other = await createCompanyRow(org.id);
    const w = await waiting(org.id);
    const same = await Promise.all([linkConversation(sales, w.id, { companyId: company.id }), linkConversation(management, w.id, { companyId: company.id })]);
    expect(same.filter((r) => !r.alreadyLinked)).toHaveLength(1);
    const w2 = await waiting(org.id);
    const results = await Promise.allSettled([linkConversation(sales, w2.id, { companyId: company.id }), linkConversation(management, w2.id, { companyId: other.id })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await adminDb.communication.count({ where: { organizationId: org.id, id: w2.id, needsLinking: false } })).toBe(1);
  });
});

describe("turning a message into a lead", () => {
  it("creates the contact and the lead for the sender and links the message", async () => {
    const { org, sales } = await setup();
    const w = await waiting(org.id, { counterpartyEmail: "wanjiru.kamau@example.test", counterpartyName: "Wanjiru Kamau", counterpartyPhone: "0722000111" });
    const result = await createLeadFromConversation(sales, w.id, {});
    expect(result).toMatchObject({ created: true, alreadyCreated: false });
    if (!result.created) throw new Error("unreachable");
    const lead = await adminDb.lead.findUniqueOrThrow({ where: { id: result.leadId }, include: { contact: true } });
    expect(lead).toMatchObject({ ownerMembershipId: sales.membershipId, contactId: result.contactId });
    expect(lead.contact).toMatchObject({ firstName: "Wanjiru", lastName: "Kamau", email: "wanjiru.kamau@example.test", phone: "0722000111" });
    expect(lead.notes).toContain("Quote please");
    expect(result.item).toMatchObject({ needsLinking: false, link: { leadId: lead.id, contactId: lead.contactId } });
    expect((await listNeedsLinking(sales, {}, {})).total).toBe(0);
    const again = await createLeadFromConversation(sales, w.id, {});
    expect(again).toMatchObject({ created: true, alreadyCreated: true, leadId: lead.id });
    expect(await adminDb.lead.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it("warns first when the sender looks like a contact that exists, and only creates once confirmed", async () => {
    const { org, sales, management } = await setup();
    const company = await createCompanyRow(org.id);
    await adminDb.contact.create({ data: { organizationId: org.id, firstName: "Existing", lastName: "Person", email: "same@example.test", companyId: company.id } });
    const w = await waiting(org.id, { counterpartyEmail: "same@example.test", counterpartyName: "Existing Person" });
    const warned = await createLeadFromConversation(sales, w.id, {});
    expect(warned).toMatchObject({ created: false, duplicateWarning: true });
    if (warned.created) throw new Error("unreachable");
    expect(warned.duplicates.length).toBeGreaterThan(0);
    expect(await adminDb.lead.count({ where: { organizationId: org.id } })).toBe(0);
    expect((await listNeedsLinking(sales, {}, {})).total).toBe(1);
    const confirmed = await createLeadFromConversation(sales, w.id, { confirmDuplicate: true });
    expect(confirmed).toMatchObject({ created: true });
    void management;
  });

  it("needs a sender to name, and a lead status", async () => {
    const { org, sales } = await setup();
    const bare = await waiting(org.id, { counterpartyEmail: undefined, counterpartyName: undefined, counterpartyPhone: "0700000000" });
    expect((await issues(createLeadFromConversation(sales, bare.id, {})))[0]).toMatchObject({ path: "firstName" });
    const named = await createLeadFromConversation(sales, bare.id, { firstName: "Caller" });
    expect(named).toMatchObject({ created: true });
    const w = await waiting(org.id);
    await expect(createLeadFromConversation(sales, w.id, { leadStatusId: "no-such-status" })).rejects.toThrow();
  });
});

describe("dismissing", () => {
  it("takes a message out of the queue with a reason, once, and it cannot then be linked", async () => {
    const { org, sales, management } = await setup();
    const company = await createCompanyRow(org.id);
    const w = await waiting(org.id);
    expect((await issues(dismissConversation(sales, w.id, { reason: " " })))[0]).toMatchObject({ path: "reason" });
    const done = await dismissConversation(sales, w.id, { reason: "Newsletter" }, NOW);
    expect(done).toMatchObject({ alreadyDismissed: false, item: { dismissReason: "Newsletter", dismissedAt: NOW, needsLinking: false } });
    expect(await dismissConversation(management, w.id, { reason: "again" }, NOW)).toMatchObject({ alreadyDismissed: true });
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "communication.dismissed", entityId: w.id } })).toBe(1);
    expect((await listNeedsLinking(sales, {}, {})).total).toBe(0);
    expect((await listConversations(sales, {}, {})).total).toBe(0);
    expect((await issues(linkConversation(sales, w.id, { companyId: company.id })))[0]).toMatchObject({ code: "CONVERSATION_DISMISSED" });
    expect((await issues(createLeadFromConversation(sales, w.id, {})))[0]).toMatchObject({ code: "CONVERSATION_DISMISSED" });
    const normal = await comm(org.id, { companyId: company.id, summary: "Has a record" });
    expect((await issues(dismissConversation(sales, normal.id, { reason: "x" })))[0]).toMatchObject({ code: "NOT_IN_QUEUE" });
  });
});

describe("logging something that matches no record", () => {
  it("is for people who can log communications, needs someone to name, and waits in the queue", async () => {
    const { org, sales, finance, technical } = await setup();
    await expect(logUnlinkedConversation(finance, { channel: "PHONE", direction: "INBOUND", summary: "x", counterpartyPhone: "0700" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(logUnlinkedConversation(technical, { channel: "PHONE", direction: "INBOUND", summary: "x", counterpartyPhone: "0700" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await issues(logUnlinkedConversation(sales, { channel: "PHONE", direction: "INBOUND", summary: "Who was that?" })))[0]).toMatchObject({ path: "counterpartyName" });
    expect((await issues(logUnlinkedConversation(sales, { channel: "FAX" as never, direction: "INBOUND", summary: "x", counterpartyName: "A" })))[0]).toMatchObject({ path: "channel" });
    expect((await issues(logUnlinkedConversation(sales, { channel: "PHONE", direction: "SIDEWAYS" as never, summary: "x", counterpartyName: "A" })))[0]).toMatchObject({ path: "direction" });
    expect((await issues(logUnlinkedConversation(sales, { channel: "PHONE", direction: "INBOUND", summary: " ", counterpartyName: "A" })))[0]).toMatchObject({ path: "summary" });
    const item = await logUnlinkedConversation(sales, { channel: "WHATSAPP", direction: "INBOUND", summary: "Asked for prices", counterpartyName: "Unknown Caller", counterpartyPhone: "0711222333" });
    expect(item).toMatchObject({ needsLinking: true, channel: "WHATSAPP", counterparty: { name: "Unknown Caller", phone: "0711222333" }, ownerMembershipId: sales.membershipId });
    expect((await listNeedsLinking(sales, {}, {})).items.map((i) => i.id)).toEqual([item.id]);
    void org;
  });
});

describe("tenant isolation", () => {
  it("another organisation cannot list, read, link, dismiss or reach a waiting message", async () => {
    const a = await setup();
    const b = await setup();
    const w = await waiting(a.org.id);
    expect((await listNeedsLinking(b.management, {}, {})).total).toBe(0);
    await expect(getConversation(b.management, w.id)).rejects.toBeInstanceOf(NotFoundError);
    const theirCompany = await createCompanyRow(b.org.id);
    await expect(linkConversation(b.management, w.id, { companyId: theirCompany.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(dismissConversation(b.management, w.id, { reason: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(createLeadFromConversation(b.management, w.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await withOrgContext(b.org.id, (tx) => tx.communication.findMany({ where: { id: w.id } }))).toEqual([]);
    // A message cannot be linked to another organisation's company, even by id.
    const mine = await createCompanyRow(a.org.id);
    await expect(linkConversation(a.management, w.id, { companyId: theirCompany.id })).rejects.toBeInstanceOf(NotFoundError);
    expect((await linkConversation(a.management, w.id, { companyId: mine.id })).alreadyLinked).toBe(false);
  });
});
