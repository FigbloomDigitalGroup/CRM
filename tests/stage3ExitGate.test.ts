/**
 * Stage 3 exit gate (B3.11, FIG-1057).
 *
 * The executable demo and the cross-cutting checks for Stage 3 (customers, delivery, finance and reporting):
 *   1. the demo walk, one person per role on a freshly created organisation: win a deal, invoice it, record a part
 *      payment, mark it overdue, renew a recurring service, link an unlinked inbound email, run the Management and
 *      personal reports, and see the totals reconcile with the fixtures;
 *   2. the lifecycle job rehearsed on seeded data, every transition audited;
 *   3. the permission matrix: every role is allowed or refused exactly by the permission it holds;
 *   4. payments are invisible to every role except Finance and Management, on every surface that could carry them;
 *   5. tenant isolation for every table Stage 3 added;
 *   6. every documented operation has a route that answers it.
 * `docs/demo/stage-3.http` is the same walk-through for a person with a running server.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { ForbiddenError } from "../src/auth/errors";
import { regenerateInboundEmailKey } from "../src/services/integrationService";
import { STAGE3_OPERATIONS } from "../src/api/stage3Operations";
import { buildOpenApiDocument } from "../src/api/openapi";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { enqueueAndRunNow } from "../src/jobs/runner";
import { getCompany } from "../src/services/companyService";
import { listConversations, linkConversation, listNeedsLinking } from "../src/services/conversationService";
import { getCustomer360 } from "../src/services/customer360Service";
import { getDashboard, loadSection } from "../src/services/dashboardService";
import * as dealService from "../src/services/dealService";
import { listCompanyDirectory } from "../src/services/directoryService";
import { exportCompaniesCsv } from "../src/services/exportService";
import { takeHandoff, updateHandoff } from "../src/services/handoffService";
import { ingestInboundEmail } from "../src/services/inboundEmailService";
import * as leadService from "../src/services/leadService";
import { getLifecycle, runLifecycleSweep } from "../src/services/lifecycleService";
import { listNotificationCentre } from "../src/services/notificationCentreService";
import {
  createInvoice,
  exportInvoicesCsv,
  getPaymentAggregates,
  listInvoices,
  listWonDealPayments,
  markInvoiceSent,
  raiseOverdueInvoiceReminders,
  recordPayment,
  setDealNextNote,
} from "../src/services/paymentService";
import { quickLog } from "../src/services/quickLogService";
import { createRecurringService, listRecurringServices, renewRecurringService } from "../src/services/recurringServiceService";
import { getReminderSettings } from "../src/services/reminderService";
import { getRenewalsAndRetention } from "../src/services/retentionService";
import { getMyMetricsV2, getReport } from "../src/services/reportsV2Service";
import { searchAll } from "../src/services/searchService";
import { setLifecycleStateManually } from "../src/services/lifecycleService";
import { createTestContext, createTestOrganization, getLeadStatusId, getPipelineStageId, getServiceId } from "./helpers/fixtures";
import { createCompanyRow, createWonDeal, day, daysFrom } from "./helpers/stage3";

const ROLES = ["MANAGEMENT", "SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL", "CUSTOMER_SUPPORT"] as const;
const DEAL_VALUE = 8123456;
const INVOICE_AMOUNT = 5551234;
const INVOICE_NUMBER = "GATE-INV-7741";

async function everyone(name = "Stage3Gate") {
  const org = await createTestOrganization(name);
  const people = {} as Record<(typeof ROLES)[number], AuthContext>;
  for (const role of ROLES) people[role] = await createTestContext(org.id, role, role.toLowerCase());
  return { org, people };
}

describe("Stage 3 demo walk", () => {
  it("win a deal, invoice it, part payment, overdue, renew, link an email, reports, and the totals reconcile", async () => {
    const org = await createTestOrganization("Stage3Demo");
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES", "demo.sales");
    const delivery = await createTestContext(org.id, "DELIVERY", "demo.delivery");
    const finance = await createTestContext(org.id, "FINANCE", "demo.finance");
    const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "demo.tech");
    const newStatus = await getLeadStatusId(org.id);
    const wonStage = await getPipelineStageId(org.id, "CLOSED_WON");
    const cctv = await getServiceId(org.id, "CCTV");
    const crm = await getServiceId(org.id, "CRM");
    const now = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    // 1. Sales captures a lead for a new customer, converts it, and wins the deal with the owner left for Delivery.
    const company = await createCompanyRow(org.id, { name: "Gate Retail Ltd", ownerMembershipId: sales.membershipId, industry: "Retail", phone: "0700555111" });
    const { lead } = await leadService.createLead(sales, { leadStatusId: newStatus, companyId: company.id, serviceInterestId: cctv });
    const converted = (await leadService.convertLead(sales, lead.id, { serviceId: cctv, value: DEAL_VALUE })) as unknown as { id: string };
    expect((await getLifecycle(management, company.id)).state?.key).toBe("PROSPECT");
    await dealService.updateDeal(sales, converted.id, { pipelineStageId: wonStage, handoff: { ownerLater: true } } as never);
    expect((await getLifecycle(management, company.id)).state?.key).toBe("CUSTOMER");

    // 2. Finance invoices the won deal, records a part payment; once the due date passes it is overdue.
    const due = iso(daysFrom(now, -10));
    const invoice = await createInvoice(finance, { number: INVOICE_NUMBER, amount: INVOICE_AMOUNT, issuedOn: iso(daysFrom(now, -40)), dueOn: due, dealId: converted.id });
    expect(invoice.status).toBe("DRAFT");
    expect((await markInvoiceSent(finance, invoice.id)).status).toBe("OVERDUE");
    const part = await recordPayment(finance, invoice.id, { amount: 2000000, methodLabel: "Bank transfer", reference: "TRX-1" });
    expect(part).toMatchObject({ status: "OVERDUE", paidAmount: "2000000.00", balance: "3551234.00", storedStatus: "PART_PAID" });
    const aggregates = await getPaymentAggregates(finance);
    expect(aggregates.overdue).toMatchObject({ count: 1, outstanding: "3551234.00" });
    expect(aggregates.collectedThisMonth.amount).toBe("2000000.00");
    await setDealNextNote(finance, converted.id, { note: "Chase the balance Friday", nextOn: iso(daysFrom(now, 2)) });
    expect((await listWonDealPayments(finance)).items[0]).toMatchObject({ dealId: converted.id, state: "OVERDUE", invoiced: "5551234.00", received: "2000000.00" });
    expect(await raiseOverdueInvoiceReminders(org.id)).toEqual({ invoices: 1, notified: 2 });
    const salesNotice = (await listNotificationCentre(sales, {})).items.find((n) => n.type === "PAYMENT_OVERDUE");
    expect(salesNotice).toBeDefined();
    expect(JSON.stringify(salesNotice)).not.toMatch(/5551234|3551234|2000000/);

    // 3. Delivery takes the handoff and delivers: Onboarding, then Active Customer, each audited.
    await takeHandoff(delivery, converted.id);
    expect((await getLifecycle(management, company.id)).state?.key).toBe("ONBOARDING");
    await updateHandoff(delivery, converted.id, { status: "DELIVERED" });
    expect((await getLifecycle(management, company.id)).state?.key).toBe("ACTIVE_CUSTOMER");

    // 4. A recurring service is added, renewed with a task and a draft invoice; the date moves on a period.
    const hosting = await createRecurringService(management, { companyId: company.id, serviceId: crm, billingCycle: "YEARLY", value: 90000, startsOn: iso(daysFrom(now, -300)), renewsOn: iso(daysFrom(now, 20)), ownerMembershipId: sales.membershipId });
    expect(hosting).toMatchObject({ state: "DUE_SOON" });
    const renewed = await renewRecurringService(management, hosting.id, { task: { title: "Confirm next year's plan" }, invoice: { number: "GATE-REN-1" } });
    expect(renewed.service.state).toBe("ACTIVE");
    expect(renewed.taskId).toBeTruthy();
    expect(renewed.invoiceId).toBeTruthy();
    expect((await listRecurringServices(management, { state: "ACTIVE" })).total).toBe(1);

    // 5. An email from an unknown sender waits in the queue; Sales links it to the customer; it is on the 360 timeline.
    const key = await regenerateInboundEmailKey(management);
    const inbound = await ingestInboundEmail(org.slug, key.token, { from: "Buyer <buyer@gateretail.test>", subject: "Camera warranty", text: "Is the warranty two years?", messageId: "<gate-1@mail.test>" });
    expect(inbound).toMatchObject({ logged: true, needsLinking: true });
    expect((await listNeedsLinking(sales, {}, {})).total).toBe(1);
    await expect(linkConversation(delivery, inbound.communicationId!, { companyId: company.id })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await linkConversation(sales, inbound.communicationId!, { companyId: company.id })).alreadyLinked).toBe(false);
    expect((await listNeedsLinking(sales, {}, {})).total).toBe(0);
    const contact = await adminDb.contact.create({ data: { organizationId: org.id, firstName: "Buyer", phone: "0711222333", companyId: company.id } });
    await quickLog(sales, { contactId: contact.id, channel: "CALL", outcome: "REACHED", note: "Warranty confirmed", durationSeconds: 60 });
    const c360 = await getCustomer360(sales, company.id, {});
    const titles = (c360.sections.timeline as { data: { items: { title: string }[] } }).data.items.map((i) => i.title);
    expect(titles).toEqual(expect.arrayContaining(["Camera warranty", expect.stringMatching(/Call with Buyer/), expect.stringMatching(/Lifecycle/)]));
    expect(c360.sections.payments).toMatchObject({ status: "no_access", ownerRoles: ["Finance", "Management"] });
    const financeView = await getCustomer360(finance, company.id, {});
    expect((financeView.sections.payments as { data: { totals: { outstanding: string } } }).data.totals.outstanding).toBe("3551234.00");

    // 6. Reports: Management's organisation reports and the people's own metrics reconcile with what was created.
    const wins = await getReport(management, "PER_PERSON", {});
    expect(wins.table.totals).toMatchObject({ dealsWon: 1, wonValue: `${DEAL_VALUE}.00` });
    const pipeline = await getReport(management, "LEAD_SOURCES", {});
    expect(pipeline.table.totals).toMatchObject({ leads: 1 });
    const mine = await getMyMetricsV2(sales, {});
    expect(mine.cards.find((c) => c.key === "dealsWon")?.value).toBe(1);
    expect(mine.cards.find((c) => c.key === "wonValue")?.value).toBe(`${DEAL_VALUE}.00`);
    expect(mine.cards.find((c) => c.key === "calls")?.value).toBe(1);
    const fin = await getMyMetricsV2(finance, {});
    expect(fin.cards.find((c) => c.key === "amountRecorded")?.value).toBe("2000000.00");
    expect(fin.cards.some((c) => c.key === "wonValue")).toBe(false);
    await expect(getMyMetricsV2(technical, {})).rejects.toBeInstanceOf(ForbiddenError);
    const retention = await getRenewalsAndRetention(management, {});
    expect(retention.counts).toEqual({ LAPSED: 0, DUE_30: 0, UNANSWERED_PROPOSALS: 0, GOING_QUIET: 0, CROSS_SELL: 0 });
  });
});

describe("the lifecycle job on seeded data", () => {
  it("makes quiet customers dormant and moves renewals, audits every transition, and a re-run changes nothing", async () => {
    const { org, people } = await everyone("Stage3Job");
    const management = people.MANAGEMENT;
    const sales = people.SALES;
    const old = daysFrom(new Date(), -400);
    const quiet = await createCompanyRow(org.id, { name: "Quiet", lifecycleKey: "ACTIVE_CUSTOMER", ownerMembershipId: sales.membershipId, createdAt: old });
    const busy = await createCompanyRow(org.id, { name: "Busy", lifecycleKey: "ACTIVE_CUSTOMER", ownerMembershipId: sales.membershipId, createdAt: old });
    await adminDb.activity.create({ data: { organizationId: org.id, companyId: busy.id, authorMembershipId: sales.membershipId, type: "NOTE", subject: "recent", occurredAt: new Date() } });
    const renewing = await createCompanyRow(org.id, { name: "Renewing", lifecycleKey: "ACTIVE_CUSTOMER", ownerMembershipId: sales.membershipId, createdAt: old });
    await adminDb.activity.create({ data: { organizationId: org.id, companyId: renewing.id, authorMembershipId: sales.membershipId, type: "NOTE", subject: "recent", occurredAt: new Date() } });
    await createRecurringService(management, { companyId: renewing.id, serviceId: await getServiceId(org.id, "CRM"), startsOn: day("2025-01-01").toISOString().slice(0, 10), renewsOn: daysFrom(new Date(), 10).toISOString().slice(0, 10) });

    const run = await enqueueAndRunNow({ organizationId: org.id, type: "lifecycle.sweep" });
    expect(run.outcome).toBe("succeeded");
    expect(run.job?.result).toMatchObject({ checked: 3, toDormant: 1, toRenewal: 1, notified: 1 });
    const keyOf = async (id: string) => (await getLifecycle(management, id)).state?.key;
    expect(await keyOf(quiet.id)).toBe("DORMANT_CUSTOMER");
    expect(await keyOf(busy.id)).toBe("ACTIVE_CUSTOMER");
    expect(await keyOf(renewing.id)).toBe("RENEWAL");
    const audited = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: "company.lifecycle_state_changed" } });
    expect(audited).toHaveLength(2);
    expect(await adminDb.lifecycleEvent.count({ where: { organizationId: org.id } })).toBe(2);

    const again = await runLifecycleSweep(org.id);
    expect(again).toMatchObject({ toDormant: 0, toRenewal: 0, toActive: 0 });
    expect(await adminDb.lifecycleEvent.count({ where: { organizationId: org.id } })).toBe(2);
    // The job for another organisation never touches this one.
    const other = await createTestOrganization("Stage3JobOther");
    await enqueueAndRunNow({ organizationId: other.id, type: "lifecycle.sweep" });
    expect(await keyOf(quiet.id)).toBe("DORMANT_CUSTOMER");
    expect(await adminDb.lifecycleEvent.count({ where: { organizationId: org.id } })).toBe(2);
  });
});

describe("permission matrix across roles", () => {
  it("each role is allowed or refused by the permission it holds, for the Stage 3 actions", async () => {
    const { org, people } = await everyone("Stage3Matrix");
    const company = await createCompanyRow(org.id, { name: "Matrix Ltd", lifecycleKey: "CUSTOMER", ownerMembershipId: people.SALES.membershipId });
    const deal = await createWonDeal(org.id, people.SALES, { companyId: company.id });
    const crm = await getServiceId(org.id, "CRM");
    const state = await adminDb.customerLifecycleState.findFirstOrThrow({ where: { organizationId: org.id, key: "RENEWAL" } });
    const counter = { n: 0 };
    const unique = () => `M-${++counter.n}-${Math.random().toString(36).slice(2, 7)}`;

    const actions: { name: string; allowed: (c: AuthContext) => boolean; run: (c: AuthContext) => Promise<unknown> }[] = [
      { name: "list invoices", allowed: (c) => c.permissionKeys.includes("finance.view.payments"), run: (c) => listInvoices(c) },
      { name: "create an invoice", allowed: (c) => c.permissionKeys.includes("finance.manage.payments"), run: (c) => createInvoice(c, { number: unique(), amount: 100, issuedOn: "2026-10-01", dueOn: "2026-12-01", dealId: deal.id }) },
      { name: "export invoices", allowed: (c) => c.permissionKeys.includes("finance.manage.payments"), run: (c) => exportInvoicesCsv(c) },
      { name: "keep the next note on a won deal", allowed: (c) => c.permissionKeys.includes("finance.view.payments") && (c.permissionKeys.includes("finance.followup.note") || c.permissionKeys.includes("finance.manage.payments")), run: (c) => setDealNextNote(c, deal.id, { note: "n" }) },
      { name: "add a recurring service", allowed: (c) => c.permissionKeys.includes("company_services.manage"), run: (c) => createRecurringService(c, { companyId: company.id, serviceId: crm, startsOn: "2026-01-01", renewsOn: "2027-01-01" }) },
      { name: "read recurring services", allowed: (c) => c.permissionKeys.includes("company_services.view"), run: (c) => listRecurringServices(c) },
      { name: "open renewals and retention", allowed: (c) => c.permissionKeys.includes("company_services.manage"), run: (c) => getRenewalsAndRetention(c, {}) },
      { name: "read the organisation reports", allowed: (c) => c.permissionKeys.includes("reporting.view.all"), run: (c) => getReport(c, "LEAD_SOURCES", {}) },
      { name: "read My metrics", allowed: (c) => c.permissionKeys.includes("reporting.view.own") || c.permissionKeys.includes("reporting.view.all"), run: (c) => getMyMetricsV2(c, {}) },
      { name: "open the conversations hub", allowed: (c) => c.permissionKeys.includes("communications.view"), run: (c) => listConversations(c, {}, {}) },
      { name: "log a call", allowed: (c) => c.permissionKeys.includes("activities.create") && c.permissionKeys.includes("communications.create"), run: (c) => quickLog(c, { companyId: company.id, channel: "CALL", outcome: "NO_ANSWER", phoneUsed: "0700000099" }) },
      { name: "open Customer 360", allowed: (c) => c.permissionKeys.includes("companies.view"), run: (c) => getCustomer360(c, company.id, {}) },
      { name: "set a lifecycle state by hand", allowed: (c) => c.permissionKeys.includes("companies.edit"), run: (c) => setLifecycleStateManually(c, company.id, { stateId: state.id, reason: "matrix" }) },
      { name: "list companies by tab", allowed: (c) => c.permissionKeys.includes("companies.view"), run: (c) => listCompanyDirectory(c, {}) },
      { name: "export a company tab", allowed: (c) => c.permissionKeys.includes("companies.export"), run: (c) => exportCompaniesCsv(c, {}) },
      { name: "read the reminder settings", allowed: (c) => c.permissionKeys.includes("organization.manage_settings"), run: (c) => getReminderSettings(c) },
    ];
    const mismatches: string[] = [];
    for (const role of ROLES) {
      const ctx = people[role];
      for (const action of actions) {
        const expected = action.allowed(ctx);
        let ok = true;
        try {
          await action.run(ctx);
        } catch (err) {
          if (!(err instanceof ForbiddenError)) throw err;
          ok = false;
        }
        if (ok !== expected) mismatches.push(`${role} / ${action.name}: expected ${expected ? "allowed" : "refused"}, got ${ok ? "allowed" : "refused"}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe("payments stay inside Finance and Management", () => {
  it("never appear for any other role: search, Customer 360, lists, exports, notifications, dashboards, conversations", async () => {
    const { org, people } = await everyone("Stage3Money");
    const sales = people.SALES;
    const company = await createCompanyRow(org.id, { name: "Money Ltd", ownerMembershipId: sales.membershipId, lifecycleKey: "ACTIVE_CUSTOMER" });
    const deal = await createWonDeal(org.id, sales, { companyId: company.id });
    await createRecurringService(people.MANAGEMENT, { companyId: company.id, serviceId: await getServiceId(org.id, "CRM"), startsOn: "2026-01-01", renewsOn: "2030-01-01" });
    const invoice = await createInvoice(people.FINANCE, { number: INVOICE_NUMBER, amount: INVOICE_AMOUNT, issuedOn: "2026-01-01", dueOn: "2026-02-01", dealId: deal.id, sent: true });
    await recordPayment(people.FINANCE, invoice.id, { amount: 1234567 });
    await setDealNextNote(people.FINANCE, deal.id, { note: "Chase the SECRETNOTE balance" });
    await raiseOverdueInvoiceReminders(org.id);

    const SECRETS = new RegExp(`${INVOICE_NUMBER}|${INVOICE_AMOUNT}|4316667|1234567|SECRETNOTE`);
    const surfaces: { name: string; load: (c: AuthContext) => Promise<unknown> }[] = [
      { name: "search", load: (c) => searchAll(c, { q: "GATE-INV" }) },
      { name: "search for the company", load: (c) => searchAll(c, { q: "Money" }) },
      { name: "Customer 360", load: (c) => getCustomer360(c, company.id, {}) },
      { name: "company list", load: (c) => listCompanyDirectory(c, {}) },
      { name: "company page", load: (c) => getCompany(c, company.id) },
      { name: "deal list", load: (c) => dealService.listDeals(c, {}) },
      { name: "notifications", load: (c) => listNotificationCentre(c, {}) },
      { name: "dashboard", load: (c) => getDashboard(c) },
      { name: "conversations", load: (c) => listConversations(c, {}, {}) },
      { name: "retention", load: (c) => getRenewalsAndRetention(c, {}) },
      { name: "recurring services", load: (c) => listRecurringServices(c) },
    ];
    const leaks: string[] = [];
    for (const role of ROLES) {
      if (role === "FINANCE" || role === "MANAGEMENT") continue;
      for (const surface of surfaces) {
        let text: string;
        try {
          const { query, ...rest } = ((await surface.load(people[role])) ?? {}) as Record<string, unknown>;
          void query;
          text = JSON.stringify(rest);
        } catch (err) {
          if (err instanceof ForbiddenError) continue;
          throw err;
        }
        if (SECRETS.test(text)) leaks.push(`${role} / ${surface.name}`);
      }
      for (const section of ["management", "delivery", "finance", "technical", "sales_today"] as const) {
        try {
          if (SECRETS.test(JSON.stringify(await loadSection(people[role], section)))) leaks.push(`${role} / dashboard ${section}`);
        } catch (err) {
          if (!(err instanceof ForbiddenError)) throw err;
        }
      }
    }
    expect(leaks).toEqual([]);

    // Finance and Management do see them: on the invoice list, the 360 and the Finance dashboard.
    for (const who of [people.FINANCE, people.MANAGEMENT]) {
      expect(JSON.stringify(await listInvoices(who))).toContain(INVOICE_NUMBER);
      expect(JSON.stringify(await getCustomer360(who, company.id, { sections: ["payments"] }))).toContain(INVOICE_NUMBER);
    }
    expect((await loadSection(people.FINANCE, "finance") as { data: { payments: { overdue: { count: number } } } }).data.payments.overdue.count).toBe(1);
    // The notification that did go to the deal owner says an invoice is overdue, and nothing more.
    const salesNote = (await listNotificationCentre(sales, {})).items.filter((n) => n.type === "PAYMENT_OVERDUE");
    expect(salesNote).toHaveLength(1);
    // Only the words the deal owner reads: no currency, no amount, no invoice number.
    expect(salesNote.map((n) => `${n.title} ${n.body}`).join(" ")).not.toMatch(/KES|\d{4,}|invoice/i);
  });
});

describe("tenant isolation for the Stage 3 tables", () => {
  it("another organisation reads none of the rows and cannot write into this one", async () => {
    const a = await everyone("Stage3IsoA");
    const b = await everyone("Stage3IsoB");
    const company = await createCompanyRow(a.org.id, { name: "Iso Ltd", lifecycleKey: "ACTIVE_CUSTOMER", ownerMembershipId: a.people.SALES.membershipId });
    const deal = await createWonDeal(a.org.id, a.people.SALES, { companyId: company.id });
    const invoice = await createInvoice(a.people.FINANCE, { number: "ISO-1", amount: 100, issuedOn: "2026-10-01", dueOn: "2026-12-01", dealId: deal.id, sent: true });
    await recordPayment(a.people.FINANCE, invoice.id, { amount: 10 });
    await setDealNextNote(a.people.FINANCE, deal.id, { note: "x" });
    await createRecurringService(a.people.MANAGEMENT, { companyId: company.id, serviceId: await getServiceId(a.org.id, "CRM"), startsOn: "2026-01-01", renewsOn: "2027-01-01" });
    await runLifecycleSweep(a.org.id, daysFrom(new Date(), 500));
    const key = await regenerateInboundEmailKey(a.people.MANAGEMENT);
    await ingestInboundEmail(a.org.slug, key.token, { from: "x@nowhere.test", subject: "Hi", text: "waiting" });

    const seenFromB = await withOrgContext(b.org.id, async (tx) => ({
      invoices: await tx.invoice.count({ where: { organizationId: a.org.id } }),
      payments: await tx.paymentRecord.count({ where: { organizationId: a.org.id } }),
      notes: await tx.dealPaymentNote.count({ where: { organizationId: a.org.id } }),
      recurring: await tx.recurringService.count({ where: { organizationId: a.org.id } }),
      lifecycle: await tx.lifecycleEvent.count({ where: { organizationId: a.org.id } }),
      waiting: await tx.communication.count({ where: { organizationId: a.org.id, needsLinking: true } }),
    }));
    expect(seenFromB).toEqual({ invoices: 0, payments: 0, notes: 0, recurring: 0, lifecycle: 0, waiting: 0 });
    const seenFromA = await withOrgContext(a.org.id, async (tx) => ({ invoices: await tx.invoice.count(), recurring: await tx.recurringService.count(), waiting: await tx.communication.count({ where: { needsLinking: true } }) }));
    expect(seenFromA).toEqual({ invoices: 1, recurring: 1, waiting: 1 });

    const state = await adminDb.customerLifecycleState.findFirstOrThrow({ where: { organizationId: a.org.id, key: "CUSTOMER" } });
    const writes: (() => Promise<unknown>)[] = [
      () => withOrgContext(b.org.id, (tx) => tx.invoice.create({ data: { organizationId: a.org.id, companyId: company.id, number: "SNEAK", amount: "1.00", issuedOn: day("2026-10-01"), dueOn: day("2026-10-02") } })),
      () => withOrgContext(b.org.id, (tx) => tx.paymentRecord.create({ data: { organizationId: a.org.id, invoiceId: invoice.id, amount: "1.00", paidOn: day("2026-10-01") } })),
      () => withOrgContext(b.org.id, (tx) => tx.dealPaymentNote.create({ data: { organizationId: a.org.id, dealId: deal.id, note: "x" } })),
      () => withOrgContext(b.org.id, (tx) => tx.recurringService.create({ data: { organizationId: a.org.id, companyId: company.id, serviceId: state.id, startsOn: day("2026-01-01"), renewsOn: day("2027-01-01") } })),
      () => withOrgContext(b.org.id, (tx) => tx.lifecycleEvent.create({ data: { organizationId: a.org.id, companyId: company.id, toStateId: state.id, reason: "MANUAL" } })),
    ];
    for (const write of writes) await expect(write()).rejects.toThrow();
    // A record of another organisation cannot be pointed at: the composite keys refuse it.
    const bCompany = await createCompanyRow(b.org.id, { name: "Theirs" });
    await expect(adminDb.invoice.create({ data: { organizationId: a.org.id, companyId: bCompany.id, number: "CROSS", amount: "1.00", issuedOn: day("2026-10-01"), dueOn: day("2026-10-02") } })).rejects.toThrow();
  });
});

describe("the contract", () => {
  it("every documented Stage 3 operation has a route that exports its method, and the document lists them all", async () => {
    const doc = buildOpenApiDocument() as { paths: Record<string, Record<string, { operationId: string }>> };
    const missing: string[] = [];
    for (const op of STAGE3_OPERATIONS) {
      const relative = op.path.replace("/api/orgs/{orgSlug}", "/api/orgs/[orgSlug]").replace(/\{(\w+)\}/g, "[$1]");
      const file = join(process.cwd(), "src/app", relative, "route.ts");
      if (!existsSync(file)) {
        missing.push(`${op.method} ${op.path}: no route file`);
        continue;
      }
      const mod = (await import(file)) as Record<string, unknown>;
      if (typeof mod[op.method.toUpperCase()] !== "function") missing.push(`${op.method} ${op.path}: route does not export ${op.method.toUpperCase()}`);
      expect(doc.paths[op.path]?.[op.method]?.operationId).toBe(op.operationId);
    }
    expect(missing).toEqual([]);
    expect(new Set(STAGE3_OPERATIONS.map((o) => o.operationId)).size).toBe(STAGE3_OPERATIONS.length);
  });
});
