import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { listCommunicationsForCompany } from "../src/services/communicationService";
import { listConversations } from "../src/services/conversationService";
import { dialLinks, getQuickLogPrompt, quickLog } from "../src/services/quickLogService";
import { createTestContext, createTestOrganization, getLeadStatusId, getPipelineStageId } from "./helpers/fixtures";
import { createCompanyRow, daysFrom } from "./helpers/stage3";

const NOW = new Date("2026-11-10T09:00:00.000Z");

async function setup() {
  const org = await createTestOrganization("QuickLog");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const sales = await createTestContext(org.id, "SALES");
  const otherSales = await createTestContext(org.id, "SALES", "other.sales");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const finance = await createTestContext(org.id, "FINANCE");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
  const company = await createCompanyRow(org.id, { name: "Dial Ltd", ownerMembershipId: sales.membershipId, phone: "0700 111 222" });
  const contact = await adminDb.contact.create({ data: { organizationId: org.id, firstName: "Njeri", lastName: "Mwangi", phone: "+254 722 333 444", companyId: company.id } });
  const noPhoneContact = await adminDb.contact.create({ data: { organizationId: org.id, firstName: "Silent", companyId: null } });
  const lead = await adminDb.lead.create({ data: { organizationId: org.id, companyId: company.id, contactId: contact.id, leadStatusId: await getLeadStatusId(org.id), ownerMembershipId: sales.membershipId } });
  return { org, management, sales, otherSales, delivery, finance, technical, company, contact, noPhoneContact, lead };
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

describe("phone links", () => {
  it("turns a number into a tel: and wa.me link, taking a number without a country code to be Kenyan", () => {
    expect(dialLinks("+254 722 333 444")).toEqual({ tel: "tel:+254722333444", whatsapp: "https://wa.me/254722333444", digits: "254722333444" });
    expect(dialLinks("0722 333 444")?.digits).toBe("254722333444");
    expect(dialLinks("722333444")?.digits).toBe("254722333444");
    expect(dialLinks("00254722333444")?.digits).toBe("254722333444");
    expect(dialLinks("+44 7700 900123")?.digits).toBe("447700900123");
    expect(dialLinks("")).toBeNull();
    expect(dialLinks(null)).toBeNull();
    expect(dialLinks("n/a")).toBeNull();
    expect(dialLinks("123")).toBeNull();
  });
});

describe("the prompt after a tap", () => {
  it("gives the number to dial, falls back to the company, and says NO_PHONE_ON_FILE when there is none", async () => {
    const { sales, contact, company, lead, noPhoneContact } = await setup();
    expect(await getQuickLogPrompt(sales, { contactId: contact.id })).toMatchObject({ label: "Njeri Mwangi", hasPhone: true, code: null, telHref: "tel:+254722333444", whatsappHref: "https://wa.me/254722333444" });
    expect(await getQuickLogPrompt(sales, { leadId: lead.id })).toMatchObject({ label: "Njeri Mwangi", hasPhone: true });
    expect(await getQuickLogPrompt(sales, { companyId: company.id })).toMatchObject({ label: "Dial Ltd", phone: "0700 111 222", telHref: "tel:+254700111222" });
    expect(await getQuickLogPrompt(sales, { contactId: noPhoneContact.id })).toMatchObject({ hasPhone: false, code: "NO_PHONE_ON_FILE", telHref: null, whatsappHref: null, phone: null });
    expect((await issues(getQuickLogPrompt(sales, {} as never)))[0]).toMatchObject({ path: "contactId" });
    expect((await issues(getQuickLogPrompt(sales, { contactId: contact.id, leadId: lead.id })))[0]).toMatchObject({ path: "contactId" });
  });
});

describe("quick-log", () => {
  it("logs a reached call on the timeline and in the hub, updates last contacted and the score, and can leave a follow-up task", async () => {
    const { org, sales, contact, company, lead } = await setup();
    const before = await adminDb.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(before.lastContactedAt).toBeNull();

    const result = await quickLog(sales, { leadId: lead.id, channel: "CALL", outcome: "REACHED", note: "Wants a site visit on Friday", durationSeconds: 240, followUp: { title: "Send the quote", dueOn: "2026-11-14" } }, NOW);
    expect(result).toMatchObject({ lastContactedAt: NOW, link: { leadId: lead.id, contactId: contact.id, companyId: company.id } });

    const activity = await adminDb.activity.findUniqueOrThrow({ where: { id: result.activityId } });
    expect(activity).toMatchObject({ type: "CALL", subject: "Call: Reached", description: "Wants a site visit on Friday", outcome: "REACHED", authorMembershipId: sales.membershipId, leadId: lead.id, contactId: contact.id, companyId: company.id });
    const communication = await adminDb.communication.findUniqueOrThrow({ where: { id: result.communicationId } });
    expect(communication).toMatchObject({ channel: "PHONE", direction: "OUTBOUND", activityId: activity.id, durationSeconds: 240, summary: "Wants a site visit on Friday", counterpartyPhone: "+254 722 333 444", needsLinking: false });

    expect((await adminDb.lead.findUniqueOrThrow({ where: { id: lead.id } })).lastContactedAt).toEqual(NOW);
    expect((await adminDb.contact.findUniqueOrThrow({ where: { id: contact.id } })).lastContactedAt).toEqual(NOW);
    expect((await adminDb.lead.findUniqueOrThrow({ where: { id: lead.id } })).scoredAt).not.toBeNull();
    const task = await adminDb.task.findUniqueOrThrow({ where: { id: result.taskId! } });
    expect(task).toMatchObject({ title: "Send the quote", assigneeMembershipId: sales.membershipId, leadId: lead.id, companyId: company.id });
    expect(task.dueAt).toEqual(new Date("2026-11-14T00:00:00.000Z"));

    // On the record's timeline and in the Conversations hub, once.
    expect((await listCommunicationsForCompany(sales, company.id)).map((c) => c.id)).toContain(result.communicationId);
    const hub = await listConversations(sales, { tab: "CALLS" }, {});
    expect(hub.items.filter((i) => i.link.leadId === lead.id)).toHaveLength(1);
    expect(hub.items[0]).toMatchObject({ kind: "COMMUNICATION", channel: "PHONE", durationSeconds: 240 });
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "quick_log.created", entityId: result.communicationId } })).toBe(1);
  });

  it("a call nobody answered goes on the timeline but does not count as contact", async () => {
    const { sales, contact, lead } = await setup();
    const result = await quickLog(sales, { contactId: contact.id, channel: "CALL", outcome: "NO_ANSWER" }, NOW);
    expect(result.lastContactedAt).toBeNull();
    expect((await adminDb.contact.findUniqueOrThrow({ where: { id: contact.id } })).lastContactedAt).toBeNull();
    expect((await adminDb.lead.findUniqueOrThrow({ where: { id: lead.id } })).lastContactedAt).toBeNull();
    expect((await adminDb.communication.findUniqueOrThrow({ where: { id: result.communicationId } })).summary).toBe("Call: No answer.");
    const left = await quickLog(sales, { contactId: contact.id, channel: "WHATSAPP", outcome: "LEFT_MESSAGE", note: "Sent prices" }, NOW);
    expect(await adminDb.communication.findUniqueOrThrow({ where: { id: left.communicationId } })).toMatchObject({ channel: "WHATSAPP", summary: "Sent prices" });
    expect((await adminDb.activity.findUniqueOrThrow({ where: { id: left.activityId } })).subject).toBe("WhatsApp: Left a message");
  });

  it("about a deal logs against the deal and its company, and keeps the deal's activity up to date", async () => {
    const { org, sales, company, contact } = await setup();
    const deal = await adminDb.deal.create({ data: { organizationId: org.id, companyId: company.id, primaryContactId: contact.id, ownerMembershipId: sales.membershipId, pipelineStageId: await getPipelineStageId(org.id), lastActivityAt: daysFrom(NOW, -30) } });
    const result = await quickLog(sales, { dealId: deal.id, channel: "CALL", outcome: "REACHED" }, NOW);
    expect(result.link).toMatchObject({ dealId: deal.id, companyId: company.id, contactId: contact.id });
    expect((await adminDb.deal.findUniqueOrThrow({ where: { id: deal.id } })).lastActivityAt).toEqual(NOW);
  });

  it("returns NO_PHONE_ON_FILE when the record has no number, unless the caller says which number was used", async () => {
    const { sales, noPhoneContact } = await setup();
    const refused = await issues(quickLog(sales, { contactId: noPhoneContact.id, channel: "CALL", outcome: "REACHED" }, NOW));
    expect(refused[0]).toMatchObject({ code: "NO_PHONE_ON_FILE", path: "phoneUsed" });
    expect(await adminDb.activity.count({ where: { contactId: noPhoneContact.id } })).toBe(0);
    const ok = await quickLog(sales, { contactId: noPhoneContact.id, channel: "CALL", outcome: "REACHED", phoneUsed: "0733 000 111" }, NOW);
    expect((await adminDb.communication.findUniqueOrThrow({ where: { id: ok.communicationId } })).counterpartyPhone).toBe("0733 000 111");
    expect((await issues(quickLog(sales, { contactId: noPhoneContact.id, channel: "CALL", outcome: "REACHED", phoneUsed: "abc" }, NOW)))[0]).toMatchObject({ code: "NO_PHONE_ON_FILE" });
  });

  it("validates the channel, outcome, duration, note, follow-up and target", async () => {
    const { sales, contact } = await setup();
    const base = { contactId: contact.id, channel: "CALL" as const, outcome: "REACHED" as const };
    expect((await issues(quickLog(sales, { ...base, channel: "SMS" as never }, NOW)))[0]).toMatchObject({ path: "channel" });
    expect((await issues(quickLog(sales, { ...base, outcome: "BUSY" as never }, NOW)))[0]).toMatchObject({ path: "outcome" });
    expect((await issues(quickLog(sales, { ...base, durationSeconds: -1 }, NOW)))[0]).toMatchObject({ path: "durationSeconds" });
    expect((await issues(quickLog(sales, { ...base, durationSeconds: 1.5 }, NOW)))[0]).toMatchObject({ path: "durationSeconds" });
    expect((await issues(quickLog(sales, { ...base, channel: "WHATSAPP", durationSeconds: 10 }, NOW)))[0]).toMatchObject({ path: "durationSeconds" });
    expect((await issues(quickLog(sales, { ...base, note: "x".repeat(2001) }, NOW)))[0]).toMatchObject({ path: "note" });
    expect((await issues(quickLog(sales, { ...base, followUp: { title: " " } }, NOW)))[0]).toMatchObject({ path: "followUp.title" });
    expect((await issues(quickLog(sales, { ...base, followUp: { title: "x", dueOn: "someday" } }, NOW)))[0]).toMatchObject({ path: "followUp.dueOn" });
    expect((await issues(quickLog(sales, { channel: "CALL", outcome: "REACHED" } as never, NOW)))[0]).toMatchObject({ path: "contactId" });
  });

  it("is for people who can log activities and communications, and only on records they can open", async () => {
    const { org, sales, otherSales, delivery, finance, technical, contact, lead } = await setup();
    await expect(quickLog(finance, { contactId: contact.id, channel: "CALL", outcome: "REACHED" }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(quickLog(technical, { contactId: contact.id, channel: "CALL", outcome: "REACHED" }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getQuickLogPrompt(finance, { contactId: contact.id })).rejects.toBeInstanceOf(ForbiddenError);
    // Delivery may log a call to a customer contact.
    expect((await quickLog(delivery, { contactId: contact.id, channel: "CALL", outcome: "REACHED" }, NOW)).communicationId).toBeTruthy();
    // A colleague's lead is not theirs to log against.
    await expect(quickLog(otherSales, { leadId: lead.id, channel: "CALL", outcome: "REACHED" }, NOW)).rejects.toBeInstanceOf(NotFoundError);
    // A follow-up task needs the task permission.
    await expect(quickLog(delivery, { contactId: contact.id, channel: "CALL", outcome: "REACHED", followUp: { title: "x" } }, NOW)).resolves.toBeDefined();
    // An archived company is read-only.
    const archived = await createCompanyRow(org.id, { name: "Archived", phone: "0700000001" });
    await adminDb.company.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    await expect(quickLog(sales, { companyId: archived.id, channel: "CALL", outcome: "REACHED" }, NOW)).rejects.toMatchObject({ message: expect.stringMatching(/archived/i) });
  });

  it("never reaches another organisation's records", async () => {
    const a = await setup();
    const b = await setup();
    await expect(quickLog(b.sales, { contactId: a.contact.id, channel: "CALL", outcome: "REACHED" }, NOW)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getQuickLogPrompt(b.sales, { companyId: a.company.id })).rejects.toBeInstanceOf(NotFoundError);
    expect(await adminDb.communication.count({ where: { organizationId: a.org.id } })).toBe(0);
    expect(await adminDb.communication.count({ where: { organizationId: b.org.id } })).toBe(0);
  });
});
