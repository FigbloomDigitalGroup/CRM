import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { checkNewPayment, fromCents, standingOf, statusAfterPayments, toCents } from "../src/lib/payments";
import { searchAll } from "../src/services/searchService";
import {
  clearDealNextNote,
  createInvoice,
  exportInvoicesCsv,
  getDealNextNote,
  getInvoice,
  getPaymentAggregates,
  listInvoices,
  listWonDealPayments,
  markInvoiceSent,
  raiseOverdueInvoiceReminders,
  recordPayment,
  reversePayment,
  setDealNextNote,
  updateInvoice,
  voidInvoice,
} from "../src/services/paymentService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";
import { createCompanyRow, createOpenDeal, createWonDeal, day } from "./helpers/stage3";

const NOW = new Date("2026-11-10T09:00:00.000Z");

async function setup() {
  const org = await createTestOrganization("Payments");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const finance = await createTestContext(org.id, "FINANCE");
  const sales = await createTestContext(org.id, "SALES");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
  const deal = await createWonDeal(org.id, sales, { value: 500000 });
  return { org, management, finance, sales, delivery, technical, deal };
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

describe("payment rules (FIG-1049)", () => {
  it("adds money in whole cents", () => {
    expect(toCents("0.1") + toCents("0.2")).toBe(30);
    expect(fromCents(123456)).toBe("1234.56");
    expect(toCents("10")).toBe(1000);
    expect(toCents(25000.5)).toBe(2500050);
  });

  it("derives overdue from the due date, and only for sent invoices with a balance", () => {
    const today = day("2026-11-10");
    const base = { amountCents: 100000, paidCents: 0, dueOn: day("2026-11-01") };
    expect(standingOf({ ...base, status: "SENT" }, today)).toMatchObject({ status: "OVERDUE", overdue: true, daysOverdue: 9, balanceCents: 100000 });
    expect(standingOf({ ...base, status: "PART_PAID", paidCents: 40000 }, today)).toMatchObject({ status: "OVERDUE", balanceCents: 60000 });
    expect(standingOf({ ...base, status: "DRAFT" }, today).status).toBe("DRAFT");
    expect(standingOf({ ...base, status: "PAID", paidCents: 100000 }, today)).toMatchObject({ status: "PAID", overdue: false, balanceCents: 0 });
    expect(standingOf({ ...base, status: "VOID" }, today).status).toBe("VOID");
    expect(standingOf({ ...base, status: "SENT", dueOn: day("2026-11-10") }, today)).toMatchObject({ status: "SENT", overdue: false });
    expect(standingOf({ ...base, status: "PAID", paidCents: 120000 }, today)).toMatchObject({ overpaidCents: 20000, balanceCents: 0 });
  });

  it("refuses a payment above the amount unless overpayment is explicitly allowed", () => {
    const base = { status: "SENT" as const, amountCents: 100000, paidCents: 60000 };
    expect(checkNewPayment({ ...base, paymentCents: 40000, allowOverpayment: false })).toEqual({ ok: true, paidCents: 100000 });
    expect(checkNewPayment({ ...base, paymentCents: 40001, allowOverpayment: false })).toMatchObject({ ok: false, code: "OVERPAYMENT", maxCents: 40000 });
    expect(checkNewPayment({ ...base, paymentCents: 40001, allowOverpayment: true })).toMatchObject({ ok: true });
    expect(checkNewPayment({ ...base, status: "DRAFT", paymentCents: 1, allowOverpayment: false })).toMatchObject({ code: "INVOICE_NOT_SENT" });
    expect(checkNewPayment({ ...base, status: "VOID", paymentCents: 1, allowOverpayment: false })).toMatchObject({ code: "INVOICE_VOID" });
    expect(statusAfterPayments("SENT", 100000, 100000)).toBe("PAID");
    expect(statusAfterPayments("PAID", 100000, 50000)).toBe("PART_PAID");
    expect(statusAfterPayments("PART_PAID", 100000, 0)).toBe("SENT");
    expect(statusAfterPayments("DRAFT", 100000, 0)).toBe("DRAFT");
  });
});

describe("invoices and payments", () => {
  it("Finance and Management manage them; every other role is refused", async () => {
    const { finance, management, sales, delivery, technical, deal } = await setup();
    const input = { number: "INV-1", amount: 100000, issuedOn: "2026-11-01", dueOn: "2026-11-15", dealId: deal.id };
    await expect(createInvoice(sales, input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createInvoice(delivery, input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createInvoice(technical, input)).rejects.toBeInstanceOf(ForbiddenError);
    const inv = await createInvoice(finance, input, NOW);
    expect(inv).toMatchObject({ number: "INV-1", status: "DRAFT", amount: "100000.00", balance: "100000.00", dealId: deal.id, companyId: deal.companyId });
    for (const who of [sales, delivery, technical]) {
      await expect(getInvoice(who, inv.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listInvoices(who)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getPaymentAggregates(who)).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await getInvoice(management, inv.id, NOW)).number).toBe("INV-1");
    const second = await createInvoice(management, { number: "INV-2", amount: "2500.50", issuedOn: "2026-11-02", dueOn: "2026-11-30", companyId: deal.companyId });
    expect(second.dealId).toBeNull();
  });

  it("validates the target, the number, the dates and the amount", async () => {
    const { finance, org, sales, deal } = await setup();
    const open = await createOpenDeal(org.id, sales);
    const base = { number: "V-1", amount: 1000, issuedOn: "2026-11-01", dueOn: "2026-11-15", dealId: deal.id };
    expect((await issues(createInvoice(finance, { ...base, dealId: open.id })))[0]).toMatchObject({ code: "DEAL_NOT_WON" });
    expect((await issues(createInvoice(finance, { ...base, dealId: undefined })))[0]).toMatchObject({ path: "companyId" });
    const other = await createCompanyRow(org.id);
    expect((await issues(createInvoice(finance, { ...base, companyId: other.id })))[0]).toMatchObject({ code: "COMPANY_MISMATCH" });
    expect((await issues(createInvoice(finance, { ...base, amount: 0 })))[0]).toMatchObject({ path: "amount" });
    expect((await issues(createInvoice(finance, { ...base, amount: "12.345" })))[0]).toMatchObject({ path: "amount" });
    expect((await issues(createInvoice(finance, { ...base, dueOn: "2026-10-01" })))[0]).toMatchObject({ path: "dueOn" });
    expect((await issues(createInvoice(finance, { ...base, number: "  " })))[0]).toMatchObject({ path: "number" });
    await createInvoice(finance, base);
    expect((await issues(createInvoice(finance, { ...base, number: "v-1" })))[0]).toMatchObject({ code: "DUPLICATE_INVOICE_NUMBER" });
    await expect(createInvoice(finance, { ...base, number: "V-9", dealId: "00000000-0000-0000-0000-000000000000" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("walks draft, sent, part-paid, paid, with overpayment refused and a reversal putting it back", async () => {
    const { finance, deal } = await setup();
    const inv = await createInvoice(finance, { number: "W-1", amount: 100000, issuedOn: "2026-11-01", dueOn: "2026-12-01", dealId: deal.id }, NOW);
    expect((await issues(recordPayment(finance, inv.id, { amount: 1000 }, NOW)))[0]).toMatchObject({ code: "INVOICE_NOT_SENT" });
    expect((await markInvoiceSent(finance, inv.id, NOW)).status).toBe("SENT");

    const part = await recordPayment(finance, inv.id, { amount: 60000, paidOn: "2026-11-05", methodLabel: "M-Pesa", reference: "QWE123" }, NOW);
    expect(part).toMatchObject({ status: "PART_PAID", paidAmount: "60000.00", balance: "40000.00" });
    expect(part.payments).toHaveLength(1);

    const refused = await issues(recordPayment(finance, inv.id, { amount: 40000.01 }, NOW));
    expect(refused[0]).toMatchObject({ code: "OVERPAYMENT", path: "amount" });
    expect((await getInvoice(finance, inv.id, NOW)).paidAmount).toBe("60000.00");

    const paid = await recordPayment(finance, inv.id, { amount: 40000, paidOn: "2026-11-09" }, NOW);
    expect(paid).toMatchObject({ status: "PAID", balance: "0.00", overdue: false });

    const payment = paid.payments[1]!;
    const back = await reversePayment(finance, payment.id, { reason: "Entered against the wrong invoice" }, NOW);
    expect(back).toMatchObject({ status: "PART_PAID", paidAmount: "60000.00" });
    expect(back.payments.find((p) => p.id === payment.id)).toMatchObject({ reversed: true, reversalReason: "Entered against the wrong invoice" });
    expect((await reversePayment(finance, payment.id, { reason: "again" }, NOW)).paidAmount).toBe("60000.00");

    // Overpayment accepted only when asked for, and remembered on the invoice.
    const over = await recordPayment(finance, inv.id, { amount: 45000, allowOverpayment: true }, NOW);
    expect(over).toMatchObject({ status: "PAID", overpaid: "5000.00", allowOverpayment: true });
  });

  it("voids only an invoice with no payments, and a void invoice cannot change", async () => {
    const { finance, deal } = await setup();
    const inv = await createInvoice(finance, { number: "X-1", amount: 5000, issuedOn: "2026-11-01", dueOn: "2026-12-01", dealId: deal.id, sent: true }, NOW);
    await recordPayment(finance, inv.id, { amount: 1000 }, NOW);
    expect((await issues(voidInvoice(finance, inv.id, { reason: "Duplicate" }, NOW)))[0]).toMatchObject({ code: "INVOICE_HAS_PAYMENTS" });
    const detail = await getInvoice(finance, inv.id, NOW);
    await reversePayment(finance, detail.payments[0]!.id, { reason: "Mistake" }, NOW);
    expect((await issues(voidInvoice(finance, inv.id, { reason: " " }, NOW)))[0]).toMatchObject({ path: "reason" });
    const voided = await voidInvoice(finance, inv.id, { reason: "Raised twice" }, NOW);
    expect(voided).toMatchObject({ status: "VOID", voidReason: "Raised twice" });
    expect((await issues(updateInvoice(finance, inv.id, { notes: "x" }, NOW)))[0]).toMatchObject({ code: "INVOICE_VOID" });
    expect((await issues(recordPayment(finance, inv.id, { amount: 1 }, NOW)))[0]).toMatchObject({ code: "INVOICE_VOID" });
  });

  it("edits an invoice, keeps its status in line with what was received, and audits before and after", async () => {
    const { finance, org, deal } = await setup();
    const inv = await createInvoice(finance, { number: "E-1", amount: 100000, issuedOn: "2026-11-01", dueOn: "2026-12-01", dealId: deal.id, sent: true }, NOW);
    await recordPayment(finance, inv.id, { amount: 100000 }, NOW);
    expect((await issues(updateInvoice(finance, inv.id, { amount: 90000 }, NOW)))[0]).toMatchObject({ code: "AMOUNT_BELOW_PAID" });
    const raised = await updateInvoice(finance, inv.id, { amount: 150000, dueOn: "2026-12-20", notes: "Scope grew" }, NOW);
    expect(raised).toMatchObject({ status: "PART_PAID", amount: "150000.00", balance: "50000.00", notes: "Scope grew" });
    const events = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityId: inv.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["invoice.created", "invoice.updated"]);
    expect(events[1]).toMatchObject({ previousValue: expect.objectContaining({ amount: "100000.00" }), newValue: expect.objectContaining({ amount: "150000.00" }) });
  });

  it("two payments recorded at once cannot together exceed the invoice", async () => {
    const { finance, deal } = await setup();
    const inv = await createInvoice(finance, { number: "C-1", amount: 1000, issuedOn: "2026-11-01", dueOn: "2026-12-01", dealId: deal.id, sent: true }, NOW);
    const results = await Promise.allSettled([recordPayment(finance, inv.id, { amount: 800 }, NOW), recordPayment(finance, inv.id, { amount: 800 }, NOW)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await getInvoice(finance, inv.id, NOW)).paidAmount).toBe("800.00");
  });
});

describe("the list, the totals and the Finance numbers (FIG-1050)", () => {
  async function seed() {
    const ctx = await setup();
    const { finance, deal, org, sales } = ctx;
    const mk = (number: string, amount: number, dueOn: string, sent = true, dealId: string | undefined = deal.id) =>
      createInvoice(finance, { number, amount, issuedOn: "2026-10-01", dueOn, dealId, sent }, NOW);
    const overdue = await mk("L-OVERDUE", 100000, "2026-11-01");
    const partOverdue = await mk("L-PART", 80000, "2026-10-30");
    await recordPayment(finance, partOverdue.id, { amount: 30000 }, NOW);
    const thisWeek = await mk("L-WEEK", 50000, "2026-11-14");
    const later = await mk("L-LATER", 20000, "2026-12-31");
    const paid = await mk("L-PAID", 10000, "2026-10-15");
    await recordPayment(finance, paid.id, { amount: 10000, paidOn: "2026-11-03" }, NOW);
    const draft = await mk("L-DRAFT", 7000, "2026-12-01", false);
    const voided = await mk("L-VOID", 9000, "2026-12-01", false);
    await voidInvoice(finance, voided.id, { reason: "Test" }, NOW);
    return { ...ctx, overdue, partOverdue, thisWeek, later, paid, draft, voided, otherCompanyDeal: await createWonDeal(org.id, sales) };
  }

  it("filters by status, overdue, company, due range and search, and the totals match the rows", async () => {
    const { finance, overdue, partOverdue, thisWeek, later, paid, draft, voided, deal } = await seed();
    const numbers = async (filters: Parameters<typeof listInvoices>[1], sort?: string) => (await listInvoices(finance, filters, { sort }, NOW)).items.map((i) => i.number);

    expect((await numbers({ overdue: true }, "dueOn")).sort()).toEqual(["L-OVERDUE", "L-PART"]);
    expect(await numbers({ status: "OVERDUE" })).toHaveLength(2);
    expect((await numbers({ status: "SENT" })).sort()).toEqual(["L-LATER", "L-WEEK"]);
    expect(await numbers({ status: "PART_PAID" })).toEqual([]); // the part-paid one is overdue, so it is listed as overdue
    expect(await numbers({ status: "PAID" })).toEqual(["L-PAID"]);
    expect(await numbers({ status: "DRAFT" })).toEqual(["L-DRAFT"]);
    expect(await numbers({ status: "VOID" })).toEqual(["L-VOID"]);
    expect(await numbers({ dueFrom: "2026-11-10", dueTo: "2026-11-30" })).toEqual(["L-WEEK"]);
    expect(await numbers({ q: "overdue" })).toEqual(["L-OVERDUE"]);
    const byDue = await numbers({ dealId: deal.id }, "-dueOn");
    expect(byDue).toHaveLength(7);
    expect([byDue[0], byDue[6]]).toEqual(["L-LATER", "L-PAID"]);
    expect((await issues(listInvoices(finance, { status: "NOPE" }, {}, NOW)))[0]).toMatchObject({ path: "status" });
    await expect(listInvoices(finance, {}, { sort: "secret" }, NOW)).rejects.toBeInstanceOf(ValidationError);

    const page = await listInvoices(finance, {}, { pageSize: 3 }, NOW);
    expect(page).toMatchObject({ total: 7, pageSize: 3, pageCount: 3 });
    expect(page.nextCursor).toBeTruthy();
    const t = page.totals.byStatus;
    expect(t.OVERDUE).toEqual({ count: 2, amount: "180000.00", outstanding: "150000.00" });
    expect(t.SENT).toEqual({ count: 2, amount: "70000.00", outstanding: "70000.00" });
    expect(t.PAID).toEqual({ count: 1, amount: "10000.00", outstanding: "0.00" });
    expect(t.DRAFT.count).toBe(1);
    expect(t.VOID.count).toBe(1);
    expect(page.totals.outstanding).toBe("220000.00");
    expect(page.totals.nothingToCollect).toBe(false);
    void overdue; void partOverdue; void thisWeek; void later; void paid; void draft; void voided;
  });

  it("reports the Finance numbers: due this week, overdue, collected this month, and the nothing-to-collect state", async () => {
    const { finance, org, management } = await seed();
    const agg = await getPaymentAggregates(finance, NOW);
    expect(agg.dueThisWeek).toEqual({ count: 1, outstanding: "50000.00" });
    expect(agg.overdue).toEqual({ count: 2, outstanding: "150000.00", oldestDaysOverdue: 11 });
    expect(agg.collectedThisMonth).toEqual({ count: 2, amount: "40000.00" });
    expect(agg.outstanding).toBe("220000.00");
    expect(agg.nothingToCollect).toBe(false);
    expect(await getPaymentAggregates(management, NOW)).toEqual(agg);

    const emptyOrg = await createTestOrganization("PaymentsEmpty");
    const emptyFinance = await createTestContext(emptyOrg.id, "FINANCE");
    expect(await getPaymentAggregates(emptyFinance, NOW)).toMatchObject({ nothingToCollect: true, overdue: { count: 0, oldestDaysOverdue: null }, collectedThisMonth: { count: 0, amount: "0.00" } });
    const emptyList = await listInvoices(emptyFinance, {}, {}, NOW);
    expect(emptyList).toMatchObject({ total: 0, totals: { nothingToCollect: true, outstanding: "0.00" } });
    void org;
  });

  it("shows each won deal with what has been invoiced and received, and its next note", async () => {
    const { finance, deal, otherCompanyDeal } = await seed();
    await setDealNextNote(finance, deal.id, { note: "Chase the second instalment", nextOn: "2026-11-12" });
    const page = await listWonDealPayments(finance, {}, NOW);
    expect(page.total).toBe(2);
    const row = page.items.find((i) => i.dealId === deal.id)!;
    expect(row).toMatchObject({ invoiced: "260000.00", received: "40000.00", outstanding: "220000.00", invoiceCount: 5, overdueInvoices: 2, state: "OVERDUE" });
    expect(row.nextNote).toMatchObject({ note: "Chase the second instalment" });
    expect(page.items.find((i) => i.dealId === otherCompanyDeal.id)).toMatchObject({ state: "NOT_INVOICED", invoiceCount: 0, nextNote: null });
  });
});

describe("the next note on a won deal", () => {
  it("Finance and Management keep it; Sales, Delivery and Technical cannot read or write it; only a won deal has one", async () => {
    const { finance, management, sales, delivery, technical, deal, org } = await setup();
    const open = await createOpenDeal(org.id, sales);
    expect(await getDealNextNote(finance, deal.id)).toBeNull();
    const saved = await setDealNextNote(finance, deal.id, { note: "Call accounts on Friday", nextOn: "2026-11-14" });
    expect(saved).toMatchObject({ note: "Call accounts on Friday", ownerMembershipId: finance.membershipId });
    expect((await getDealNextNote(management, deal.id))?.note).toBe("Call accounts on Friday");
    const handed = await setDealNextNote(management, deal.id, { note: "Escalated", ownerMembershipId: finance.membershipId });
    expect(handed.note).toBe("Escalated");
    for (const who of [sales, delivery, technical]) {
      await expect(getDealNextNote(who, deal.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(setDealNextNote(who, deal.id, { note: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await issues(setDealNextNote(finance, open.id, { note: "x" })))[0]).toMatchObject({ code: "DEAL_NOT_WON" });
    expect((await issues(setDealNextNote(finance, deal.id, { note: " " })))[0]).toMatchObject({ path: "note" });
    expect((await issues(setDealNextNote(finance, deal.id, { note: "x", ownerMembershipId: "00000000-0000-0000-0000-000000000000" })))[0]).toMatchObject({ path: "ownerMembershipId" });
    expect(await clearDealNextNote(finance, deal.id)).toEqual({ dealId: deal.id, cleared: true });
    expect(await getDealNextNote(finance, deal.id)).toBeNull();
    const actions = (await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityType: "DealPaymentNote" }, orderBy: { createdAt: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(["deal_payment_note.created", "deal_payment_note.updated", "deal_payment_note.cleared"]);
  });
});

describe("overdue reminders", () => {
  it("tell Finance and the deal owner once, and the deal owner is never told an amount", async () => {
    const { org, finance, sales, deal } = await setup();
    const inv = await createInvoice(finance, { number: "R-1", amount: 123456, issuedOn: "2026-10-01", dueOn: "2026-11-01", dealId: deal.id, sent: true }, NOW);
    await createInvoice(finance, { number: "R-2", amount: 5000, issuedOn: "2026-10-01", dueOn: "2026-12-01", dealId: deal.id, sent: true }, NOW);

    expect(await raiseOverdueInvoiceReminders(org.id, NOW)).toEqual({ invoices: 1, notified: 2 });
    const financeNotes = await adminDb.notification.findMany({ where: { organizationId: org.id, membershipId: finance.membershipId, type: "PAYMENT_OVERDUE" } });
    const salesNotes = await adminDb.notification.findMany({ where: { organizationId: org.id, membershipId: sales.membershipId, type: "PAYMENT_OVERDUE" } });
    expect(financeNotes).toHaveLength(1);
    expect(financeNotes[0]!.body).toContain("123456.00");
    expect(salesNotes).toHaveLength(1);
    expect(JSON.stringify(salesNotes[0])).not.toMatch(/123456|KES/);

    // A second run, the next day, does not repeat it.
    await raiseOverdueInvoiceReminders(org.id, new Date(NOW.getTime() + 24 * 60 * 60 * 1000));
    expect(await adminDb.notification.count({ where: { organizationId: org.id, type: "PAYMENT_OVERDUE" } })).toBe(2);

    // A new due date is a new trigger.
    await updateInvoice(finance, inv.id, { dueOn: "2026-11-05" }, NOW);
    await raiseOverdueInvoiceReminders(org.id, NOW);
    expect(await adminDb.notification.count({ where: { organizationId: org.id, type: "PAYMENT_OVERDUE" } })).toBe(4);
  });

  it("go to Management when the organisation has no Finance member", async () => {
    const org = await createTestOrganization("PaymentsNoFinance");
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    const deal = await createWonDeal(org.id, sales);
    await createInvoice(management, { number: "M-1", amount: 100, issuedOn: "2026-10-01", dueOn: "2026-11-01", dealId: deal.id, sent: true }, NOW);
    await raiseOverdueInvoiceReminders(org.id, NOW);
    expect(await adminDb.notification.count({ where: { organizationId: org.id, membershipId: management.membershipId, type: "PAYMENT_OVERDUE" } })).toBe(1);
  });
});

describe("payments stay inside Finance and Management", () => {
  it("never appear in search for any role, and a CSV export follows the bulk rule", async () => {
    const { finance, management, sales, delivery, org, deal } = await setup();
    await createInvoice(finance, { number: "SECRET-INV-7788", amount: 777777, issuedOn: "2026-10-01", dueOn: "2026-11-01", dealId: deal.id, sent: true }, NOW);
    for (const who of [finance, management, sales, delivery]) {
      const { query, ...results } = await searchAll(who, { q: "SECRET-INV-7788" });
      void query;
      const found = JSON.stringify(results);
      expect(found).not.toContain("SECRET-INV-7788");
      expect(found).not.toContain("777777");
    }
    const csv = await exportInvoicesCsv(finance, {}, NOW);
    expect(csv.split("\n")[0]).toBe("number,company,dealId,status,currency,amount,paid,balance,issuedOn,dueOn,daysOverdue");
    expect(csv).toContain("SECRET-INV-7788");
    await expect(exportInvoicesCsv(sales, {}, NOW)).rejects.toBeInstanceOf(ForbiddenError);

    // Above 500 rows only Management (export.bulk) may export.
    await adminDb.invoice.createMany({
      data: Array.from({ length: 501 }, (_, i) => ({
        organizationId: org.id,
        companyId: deal.companyId,
        dealId: deal.id,
        number: `BULK-${i}`,
        amount: "10.00",
        issuedOn: day("2026-10-01"),
        dueOn: day("2026-12-01"),
        status: "SENT" as const,
      })),
    });
    await expect(exportInvoicesCsv(finance, {}, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await exportInvoicesCsv(management, {}, NOW)).split("\n").length).toBeGreaterThan(500);
  });

  it("another organisation cannot see, change or reach them, even with the ids", async () => {
    const a = await setup();
    const b = await setup();
    const inv = await createInvoice(a.finance, { number: "ISO-1", amount: 100, issuedOn: "2026-10-01", dueOn: "2026-12-01", dealId: a.deal.id, sent: true }, NOW);
    await recordPayment(a.finance, inv.id, { amount: 10 }, NOW);
    await expect(getInvoice(b.finance, inv.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(recordPayment(b.finance, inv.id, { amount: 1 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(voidInvoice(b.finance, inv.id, { reason: "x" })).rejects.toBeInstanceOf(NotFoundError);
    expect((await listInvoices(b.finance, {}, {}, NOW)).total).toBe(0);
    await expect(createInvoice(b.finance, { number: "ISO-2", amount: 1, issuedOn: "2026-10-01", dueOn: "2026-12-01", dealId: a.deal.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setDealNextNote(b.finance, a.deal.id, { note: "x" })).rejects.toBeInstanceOf(NotFoundError);

    // The database refuses on its own: another organisation's context reads nothing and cannot write into this one.
    const seen = await withOrgContext(b.org.id, (tx) => tx.invoice.findMany({ where: { id: inv.id } }));
    expect(seen).toEqual([]);
    const seenPayments = await withOrgContext(b.org.id, (tx) => tx.paymentRecord.findMany({ where: { invoiceId: inv.id } }));
    expect(seenPayments).toEqual([]);
    await expect(
      withOrgContext(b.org.id, (tx) =>
        tx.invoice.create({ data: { organizationId: a.org.id, companyId: a.deal.companyId, number: "SNEAK", amount: "1.00", issuedOn: day("2026-10-01"), dueOn: day("2026-10-02") } }),
      ),
    ).rejects.toThrow();
  });
});
