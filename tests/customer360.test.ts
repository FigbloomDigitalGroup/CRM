import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { dbCallStats } from "../src/db/orgScopedClient";
import { addComment } from "../src/services/commentService";
import { archiveCompany } from "../src/services/companyService";
import { getCustomer360, SECTION_KEYS, type SectionResult } from "../src/services/customer360Service";
import { createInvoice, recordPayment, setDealNextNote } from "../src/services/paymentService";
import { createTag, changeTags } from "../src/services/tagService";
import { transitionCompany } from "../src/services/lifecycleService";
import { createRecurringService } from "../src/services/recurringServiceService";
import { createTestContext, createTestOrganization, getLeadStatusId, getPipelineStageId, getServiceId } from "./helpers/fixtures";
import { createCompanyRow, createWonDeal, day, daysFrom } from "./helpers/stage3";

const NOW = new Date("2026-11-10T09:00:00.000Z");
const WON_VALUE = 8123456;
const OPEN_VALUE = 7771111;

async function setup() {
  const org = await createTestOrganization("Customer360");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const sales = await createTestContext(org.id, "SALES", "sales.a");
  const otherSales = await createTestContext(org.id, "SALES", "sales.b");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const finance = await createTestContext(org.id, "FINANCE");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
  return { org, management, sales, otherSales, delivery, finance, technical };
}

async function fixture() {
  const f = await setup();
  const { org, management, sales, otherSales, finance } = f;
  const company = await createCompanyRow(org.id, { name: "Big Customer Ltd", ownerMembershipId: sales.membershipId, lifecycleKey: "ACTIVE_CUSTOMER", industry: "Hospitality", phone: "0700000001" });
  const contact = await adminDb.contact.create({ data: { organizationId: org.id, firstName: "Amina", lastName: "Otieno", email: "amina@big.test", companyId: company.id } });
  const wonDeal = await createWonDeal(org.id, sales, { companyId: company.id, value: WON_VALUE, serviceKey: "CCTV", wonAt: daysFrom(NOW, -20) });
  const openDeal = await adminDb.deal.create({ data: { organizationId: org.id, companyId: company.id, ownerMembershipId: otherSales.membershipId, pipelineStageId: await getPipelineStageId(org.id), value: OPEN_VALUE } });
  const theirLead = await adminDb.lead.create({ data: { organizationId: org.id, companyId: company.id, leadStatusId: await getLeadStatusId(org.id), ownerMembershipId: otherSales.membershipId } });
  await adminDb.dealHandoff.create({ data: { organizationId: org.id, dealId: wonDeal.id, createdByMembershipId: sales.membershipId, deliveryOwnerMembershipId: f.delivery.membershipId, status: "ONBOARDING" } });
  // Tasks: one assigned to Sales A (due soon), one to Sales B.
  const myTask = await adminDb.task.create({ data: { organizationId: org.id, title: "Send the quote", companyId: company.id, assigneeMembershipId: sales.membershipId, createdByMembershipId: management.membershipId, dueAt: daysFrom(NOW, 3) } });
  await adminDb.task.create({ data: { organizationId: org.id, title: "Their private task", companyId: company.id, assigneeMembershipId: otherSales.membershipId, createdByMembershipId: management.membershipId, dueAt: daysFrom(NOW, 1) } });
  // History.
  await adminDb.activity.create({ data: { organizationId: org.id, companyId: company.id, authorMembershipId: sales.membershipId, type: "NOTE", subject: "Kick-off notes", occurredAt: daysFrom(NOW, -5) } });
  await adminDb.activity.create({ data: { organizationId: org.id, contactId: contact.id, authorMembershipId: sales.membershipId, type: "CALL", subject: "Call to Amina", occurredAt: daysFrom(NOW, -4) } });
  await adminDb.activity.create({ data: { organizationId: org.id, leadId: theirLead.id, companyId: company.id, authorMembershipId: otherSales.membershipId, type: "NOTE", subject: "Colleague lead note", occurredAt: daysFrom(NOW, -3) } });
  await adminDb.communication.create({ data: { organizationId: org.id, companyId: company.id, channel: "EMAIL", direction: "INBOUND", subject: "Re: install date", summary: "Friday works", occurredAt: daysFrom(NOW, -2) } });
  await adminDb.communication.create({ data: { organizationId: org.id, companyId: company.id, dealId: openDeal.id, channel: "EMAIL", direction: "OUTBOUND", subject: "About the other deal", summary: "Pricing", occurredAt: daysFrom(NOW, -1) } });
  await transitionCompany({ organizationId: org.id, companyId: company.id, toKey: "RENEWAL", reason: "RENEWAL_WINDOW", now: daysFrom(NOW, -6) });
  // Money.
  const invoice = await createInvoice(finance, { number: "C360-1", amount: 100000, issuedOn: "2026-10-20", dueOn: "2026-11-01", dealId: wonDeal.id, sent: true }, NOW);
  await recordPayment(finance, invoice.id, { amount: 30000, paidOn: "2026-10-28" }, NOW);
  await setDealNextNote(finance, wonDeal.id, { note: "Chase the balance", nextOn: "2026-11-12" });
  await createRecurringService(management, { companyId: company.id, serviceId: await getServiceId(org.id, "CRM"), value: 55000, startsOn: "2026-01-01", renewsOn: "2026-11-25", ownerMembershipId: sales.membershipId }, NOW);
  await adminDb.companyService.create({ data: { organizationId: org.id, companyId: company.id, serviceId: await getServiceId(org.id, "CCTV"), status: "ACTIVE", startDate: day("2026-01-01") } });
  const tag = await createTag(management, { name: "gold" });
  await changeTags(management, "company", company.id, { addTagIds: [tag.id] });
  await addComment(sales, "company", company.id, { body: "Great account, handle with care" });
  return { ...f, company, contact, wonDeal, openDeal, theirLead, myTask, invoice };
}

const section = <T = Record<string, unknown>>(r: { sections: Partial<Record<string, SectionResult>> }, key: string) => {
  const s = r.sections[key];
  if (!s) throw new Error(`no section ${key}`);
  return s as SectionResult<T>;
};
const data = <T = Record<string, any>>(r: { sections: Partial<Record<string, SectionResult>> }, key: string): T => {
  const s = section<T>(r, key);
  if (s.status !== "ok") throw new Error(`section ${key} is ${s.status}`);
  return s.data;
};

describe("Customer 360 for Management", () => {
  it("returns every section: profile, services, deals with values, tasks, timeline, handoffs, payments, tickets, follow-up, comments", async () => {
    const f = await fixture();
    const r = await getCustomer360(f.management, f.company.id, {}, NOW);
    expect(r.requested).toEqual([...SECTION_KEYS]);
    expect(r.company).toEqual({ id: f.company.id, name: "Big Customer Ltd", archived: false, readOnly: false });

    const profile = data(r, "profile");
    expect(profile).toMatchObject({ name: "Big Customer Ltd", industry: "Hospitality", archived: false, lifecycle: { state: { key: "RENEWAL" } }, owner: { membershipId: f.sales.membershipId } });
    expect(profile.tags.map((t: { name: string }) => t.name)).toEqual(["gold"]);
    expect(profile.contacts).toEqual([expect.objectContaining({ name: "Amina Otieno", email: "amina@big.test" })]);
    expect(profile.health).not.toBeUndefined();

    const services = data(r, "services");
    expect(services.services).toEqual([expect.objectContaining({ name: "CCTV", status: "ACTIVE" })]);
    expect(services.recurring).toEqual([expect.objectContaining({ serviceName: "CRM", value: "55000.00", state: "DUE_SOON" })]);

    const deals = data(r, "deals");
    expect(deals.total).toBe(2);
    expect(deals.items.map((d: { value: string }) => d.value).sort()).toEqual([String(OPEN_VALUE) + ".00", String(WON_VALUE) + ".00"]);
    expect(deals.items.every((d: { valueMasked: boolean }) => d.valueMasked === false)).toBe(true);

    const tasks = data(r, "tasks");
    expect(tasks.total).toBe(2);
    expect(tasks.items.map((t: { title: string }) => t.title)).toEqual(["Their private task", "Send the quote"]); // earliest due first

    const handoffs = data(r, "handoffs");
    expect(handoffs.items).toEqual([expect.objectContaining({ dealId: f.wonDeal.id, status: "ONBOARDING", deliveryOwner: expect.objectContaining({ membershipId: f.delivery.membershipId }) })]);

    const payments = data(r, "payments");
    expect(payments.totals).toEqual({ invoiced: "100000.00", received: "30000.00", outstanding: "70000.00", overdueInvoices: 1 });
    expect(payments.items).toEqual([expect.objectContaining({ number: "C360-1", status: "OVERDUE", balance: "70000.00", daysOverdue: 9 })]);
    expect(payments.followUpNotes).toEqual([expect.objectContaining({ note: "Chase the balance" })]);

    expect(section(r, "tickets")).toEqual({ status: "not_available", reason: expect.stringContaining("V1.1") });
    expect(data(r, "nextFollowUp").next).toMatchObject({ source: "TASK", title: "Their private task" });
    expect(data(r, "comments").comments).toHaveLength(1);
    expect(data(r, "attachments").items).toEqual([]);

    const timeline = data(r, "timeline");
    const kinds = timeline.items.map((i: { kind: string }) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(["ACTIVITY", "COMMUNICATION", "LIFECYCLE", "AUDIT"]));
    expect(timeline.items.map((i: { title: string }) => i.title)).toEqual(expect.arrayContaining(["Kick-off notes", "Call to Amina", "Re: install date", "Colleague lead note", "About the other deal"]));
    expect(timeline.items.find((i: { kind: string }) => i.kind === "LIFECYCLE").title).toBe("Lifecycle: Active Customer to Renewal");
    const times = timeline.items.map((i: { at: Date }) => i.at.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("loads sections independently, and refuses an unknown one", async () => {
    const f = await fixture();
    const only = await getCustomer360(f.management, f.company.id, { sections: ["payments", "deals"] }, NOW);
    expect(Object.keys(only.sections).sort()).toEqual(["deals", "payments"]);
    expect(only.requested).toEqual(["payments", "deals"]);
    await expect(getCustomer360(f.management, f.company.id, { sections: ["payments", "secrets"] }, NOW)).rejects.toBeInstanceOf(ValidationError);
    await expect(getCustomer360(f.management, "00000000-0000-0000-0000-000000000000", {}, NOW)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Customer 360 by role: masking and no-access metadata", () => {
  it("Sales sees values only for deals it owns, its own tasks, no payments (with who owns them), and nothing of a colleague's records", async () => {
    const f = await fixture();
    const r = await getCustomer360(f.sales, f.company.id, {}, NOW);
    const deals = data(r, "deals");
    expect(deals.items.map((d: { id: string }) => d.id)).toEqual([f.wonDeal.id]);
    expect(deals.items[0]).toMatchObject({ value: String(WON_VALUE) + ".00", valueMasked: false });
    expect(section(r, "deals")).toMatchObject({ status: "ok", scope: "own" });
    expect(data(r, "tasks").items.map((t: { title: string }) => t.title)).toEqual(["Send the quote"]);
    expect(section(r, "tasks")).toMatchObject({ scope: "own" });

    const payments = section(r, "payments");
    expect(payments).toEqual({ status: "no_access", requires: ["finance.view.payments"], reason: expect.stringMatching(/Finance and Management only/), yourRole: "Sales", ownerRoles: ["Finance", "Management"] });
    expect(JSON.stringify(r)).not.toMatch(/OPEN_VALUE|7771111|Their private task|About the other deal|Colleague lead note|C360-1|Chase the balance/);
    const timeline = data(r, "timeline").items.map((i: { title: string }) => i.title);
    expect(timeline).toEqual(expect.arrayContaining(["Kick-off notes", "Call to Amina", "Re: install date"]));
    expect(timeline).not.toContain("Colleague lead note");
    expect(timeline).not.toContain("About the other deal");
    expect(data(r, "timeline").items.some((i: { kind: string }) => i.kind === "AUDIT")).toBe(false); // the audit trail is for Management
  });

  it("Delivery never receives values or payments, sees won deals and handoffs, and is told why payments are out of reach", async () => {
    const f = await fixture();
    const r = await getCustomer360(f.delivery, f.company.id, {}, NOW);
    const deals = data(r, "deals");
    expect(deals.items.map((d: { id: string }) => d.id)).toEqual([f.wonDeal.id]);
    expect(deals.items[0]).toMatchObject({ value: null, valueMasked: true, outcome: "WON" });
    expect(section(r, "payments")).toMatchObject({ status: "no_access", yourRole: "Delivery", ownerRoles: ["Finance", "Management"] });
    expect(JSON.stringify(r)).not.toMatch(/8123456|7771111|55000|C360-1|Chase the balance|100000|30000/);
    expect(data(r, "services").recurring[0]).toMatchObject({ value: null, valueMasked: true });
    expect(data(r, "handoffs").items).toHaveLength(1);
    expect(data(r, "tasks").items).toEqual([]); // Delivery's own tasks only, and it has none here
  });

  it("Finance gets payments and values on won deals, and is told its tasks and history are not its work", async () => {
    const f = await fixture();
    const r = await getCustomer360(f.finance, f.company.id, {}, NOW);
    expect(data(r, "payments").totals).toMatchObject({ outstanding: "70000.00" });
    const deals = data(r, "deals");
    expect(deals.items.map((d: { id: string }) => d.id)).toEqual([f.wonDeal.id]);
    expect(deals.items[0]).toMatchObject({ value: String(WON_VALUE) + ".00", valueMasked: false });
    expect(section(r, "tasks")).toMatchObject({ status: "no_access", requires: ["tasks.view.all", "tasks.view.own"], yourRole: "Finance" });
    expect(section(r, "timeline")).toMatchObject({ status: "no_access", requires: ["activities.view", "communications.view"] });
    expect(data(r, "nextFollowUp").next).toMatchObject({ source: "PAYMENT_NOTE", title: "Chase the balance" });
    expect(JSON.stringify(r)).not.toMatch(/Their private task|Send the quote|7771111/);
  });

  it("Technical, who cannot open companies at all, gets the explained denial", async () => {
    const f = await fixture();
    await expect(getCustomer360(f.technical, f.company.id, {}, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a colleague who owns another record sees that record and not Sales A's", async () => {
    const f = await fixture();
    const r = await getCustomer360(f.otherSales, f.company.id, {}, NOW);
    expect(data(r, "deals").items.map((d: { id: string }) => d.id)).toEqual([f.openDeal.id]);
    expect(data(r, "tasks").items.map((t: { title: string }) => t.title)).toEqual(["Their private task"]);
    expect(JSON.stringify(r)).not.toMatch(/Send the quote|8123456/);
    expect(data(r, "timeline").items.map((i: { title: string }) => i.title)).toEqual(expect.arrayContaining(["Colleague lead note", "About the other deal"]));
  });
});

describe("Customer 360 archived, timeline paging, query count, isolation", () => {
  it("an archived company is read-only data with the archived flag", async () => {
    const f = await fixture();
    await archiveCompany(f.management, f.company.id, { reason: "Closed down" });
    const r = await getCustomer360(f.management, f.company.id, {}, NOW);
    expect(r.company).toMatchObject({ archived: true, readOnly: true });
    expect(section(r, "profile")).toMatchObject({ status: "ok", scope: "read-only" });
    expect(data(r, "profile")).toMatchObject({ archived: true, archiveReason: "Closed down" });
    expect(data(r, "deals").total).toBe(2);
    expect(section(r, "services")).toMatchObject({ scope: "read-only" });
  });

  it("pages the timeline by cursor with no row repeated or skipped, including rows with the same timestamp", async () => {
    const f = await setup();
    const company = await createCompanyRow(f.org.id, { name: "Busy Ltd", ownerMembershipId: f.sales.membershipId });
    const same = new Date("2026-11-01T10:00:00.000Z");
    const rows = [
      ...Array.from({ length: 40 }, (_, i) => ({ kind: "a", at: daysFrom(NOW, -i - 1) })),
      ...Array.from({ length: 6 }, () => ({ kind: "a", at: same })), // ties
      ...Array.from({ length: 6 }, () => ({ kind: "c", at: same })),
    ];
    for (const r of rows) {
      if (r.kind === "a") await adminDb.activity.create({ data: { organizationId: f.org.id, companyId: company.id, authorMembershipId: f.sales.membershipId, type: "NOTE", subject: "A", occurredAt: r.at } });
      else await adminDb.communication.create({ data: { organizationId: f.org.id, companyId: company.id, channel: "EMAIL", direction: "INBOUND", summary: "C", occurredAt: r.at } });
    }
    const total = rows.length;
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const r = await getCustomer360(f.management, company.id, { sections: ["timeline"], limit: 10, cursor }, NOW);
      const t = data(r, "timeline");
      expect(t.items.length).toBeLessThanOrEqual(10);
      seen.push(...t.items.map((i: { id: string }) => i.id));
      cursor = t.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 20);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe(total);
    expect(pages).toBe(Math.ceil(total / 10));
    await expect(getCustomer360(f.management, company.id, { sections: ["timeline"], cursor: "not-a-cursor" }, NOW)).rejects.toBeInstanceOf(ValidationError);
    const big = await getCustomer360(f.management, company.id, { sections: ["timeline"], limit: 5000 }, NOW);
    expect(data(big, "timeline").items.length).toBeLessThanOrEqual(100);
  });

  it("loads from the same number of database calls however much the customer has", async () => {
    const f = await setup();
    const small = await createCompanyRow(f.org.id, { name: "Small Ltd", ownerMembershipId: f.sales.membershipId });
    const large = await createCompanyRow(f.org.id, { name: "Large Ltd", ownerMembershipId: f.sales.membershipId });
    await adminDb.activity.create({ data: { organizationId: f.org.id, companyId: small.id, authorMembershipId: f.sales.membershipId, type: "NOTE", subject: "one", occurredAt: NOW } });
    for (let i = 0; i < 30; i++) {
      await createWonDeal(f.org.id, f.sales, { companyId: large.id, value: 1000 + i });
      await adminDb.task.create({ data: { organizationId: f.org.id, title: `T${i}`, companyId: large.id, assigneeMembershipId: f.sales.membershipId, createdByMembershipId: f.management.membershipId } });
      await adminDb.activity.create({ data: { organizationId: f.org.id, companyId: large.id, authorMembershipId: f.sales.membershipId, type: "NOTE", subject: `N${i}`, occurredAt: daysFrom(NOW, -i) } });
      await adminDb.communication.create({ data: { organizationId: f.org.id, companyId: large.id, channel: "EMAIL", direction: "INBOUND", summary: `M${i}`, occurredAt: daysFrom(NOW, -i) } });
      await adminDb.invoice.create({ data: { organizationId: f.org.id, companyId: large.id, number: `Q-${i}`, amount: "100.00", issuedOn: day("2026-10-01"), dueOn: day("2026-12-01"), status: "SENT" } });
      await adminDb.companyService.create({ data: { organizationId: f.org.id, companyId: large.id, serviceId: await getServiceId(f.org.id, "CRM"), status: "ACTIVE" } });
    }
    for (const who of [f.management, f.sales, f.finance, f.delivery]) {
      const calls = async (id: string) => {
        const before = dbCallStats.orgContextCalls;
        await getCustomer360(who, id, {}, NOW);
        return dbCallStats.orgContextCalls - before;
      };
      const few = await calls(small.id);
      const many = await calls(large.id);
      expect(many).toBe(few);
      expect(many).toBeLessThanOrEqual(40);
    }
  });

  it("never reaches another organisation's customer", async () => {
    const a = await fixture();
    const b = await setup();
    await expect(getCustomer360(b.management, a.company.id, {}, NOW)).rejects.toBeInstanceOf(NotFoundError);
    const own = await createCompanyRow(b.org.id, { name: "Theirs Ltd" });
    const r = await getCustomer360(b.management, own.id, {}, NOW);
    expect(JSON.stringify(r)).not.toMatch(/Big Customer|C360-1|8123456/);
    expect(data(r, "deals").total).toBe(0);
    expect(data(r, "payments").items).toEqual([]);
  });
});
