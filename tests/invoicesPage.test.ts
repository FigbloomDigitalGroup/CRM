import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import type { AuthContext } from "../src/auth/context";
import { createInvoice, exportInvoicesCsv, getInvoice, listInvoices, markInvoiceSent, recordPayment, reversePayment, voidInvoice } from "../src/services/paymentService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";
import { createWonDeal } from "./helpers/stage3";

/**
 * UC-R7 / UC-R9 (FIG-1785, FIG-1780): the additive list filters (amount range, still owed), the ageing buckets in the list totals, and the
 * split keys enforced on top of the existing payment keys. DB-backed like tests/payments.test.ts (needs the test database).
 */

const NOW = new Date("2026-11-10T09:00:00.000Z");

async function setup() {
  const org = await createTestOrganization("InvoicesPage");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const finance = await createTestContext(org.id, "FINANCE");
  const sales = await createTestContext(org.id, "SALES");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
  const deal = await createWonDeal(org.id, sales, { value: 900000 });
  const mk = (number: string, amount: number, dueOn: string, sent = true) => createInvoice(finance, { number, amount, issuedOn: "2026-01-01", dueOn, dealId: deal.id, sent }, NOW);
  return { org, management, finance, sales, delivery, technical, deal, mk };
}

const without = (ctx: AuthContext, ...keys: string[]): AuthContext => ({ ...ctx, permissionKeys: ctx.permissionKeys.filter((k) => !keys.includes(k)) });

describe("invoice list filters and ageing (UC-R7)", () => {
  it("filters by amount range and by still owed, and rejects a bad amount", async () => {
    const { finance, mk } = await setup();
    await mk("A-100", 100000, "2026-11-01");
    const part = await mk("A-080", 80000, "2026-10-30");
    await recordPayment(finance, part.id, { amount: 30000 }, NOW);
    await mk("A-050", 50000, "2026-11-14");
    const paid = await mk("A-010", 10000, "2026-10-15");
    await recordPayment(finance, paid.id, { amount: 10000, paidOn: "2026-11-03" }, NOW);
    await mk("A-DRAFT", 60000, "2026-12-01", false);
    const numbers = async (f: Parameters<typeof listInvoices>[1]) => (await listInvoices(finance, f, { sort: "number" }, NOW)).items.map((i) => i.number);

    expect(await numbers({ amountMin: "50000", amountMax: "100000" })).toEqual(["A-050", "A-080", "A-100"]);
    expect(await numbers({ amountMin: "90000" })).toEqual(["A-100"]);
    expect(await numbers({ amountMax: "10000" })).toEqual(["A-010"]);
    expect(await numbers({ hasBalance: true })).toEqual(["A-050", "A-080", "A-100"]);
    expect(await numbers({ hasBalance: true, status: "OVERDUE" })).toEqual(["A-080", "A-100"]);
    await expect(listInvoices(finance, { amountMin: "abc" }, {}, NOW)).rejects.toBeInstanceOf(ValidationError);
  });

  it("returns the ageing buckets with the list totals (open invoices only, by days past due)", async () => {
    const { finance, mk } = await setup();
    await mk("G-CURRENT", 20000, "2026-12-31"); // not due
    await mk("G-TODAY", 5000, "2026-11-10"); // due today is still current
    await mk("G-9", 100000, "2026-11-01"); // 9 days
    const part = await mk("G-11", 80000, "2026-10-30"); // 11 days, 30000 paid
    await recordPayment(finance, part.id, { amount: 30000 }, NOW);
    await mk("G-45", 40000, "2026-09-26"); // 45 days
    await mk("G-75", 10000, "2026-08-27"); // 75 days
    await mk("G-120", 7000, "2026-07-13"); // 120 days
    await mk("G-DRAFT", 99999, "2026-01-01", false);
    const paid = await mk("G-PAID", 3000, "2026-01-01");
    await recordPayment(finance, paid.id, { amount: 3000, paidOn: "2026-11-03" }, NOW);

    const { totals } = await listInvoices(finance, {}, {}, NOW);
    expect(totals.ageing).toEqual({
      current: { count: 2, outstanding: "25000.00" },
      d1_30: { count: 2, outstanding: "150000.00" },
      d31_60: { count: 1, outstanding: "40000.00" },
      d61_90: { count: 1, outstanding: "10000.00" },
      d90_plus: { count: 1, outstanding: "7000.00" },
    });
    // The strip does not move with the status filter or the search.
    expect((await listInvoices(finance, { status: "PAID" }, {}, NOW)).totals.ageing).toEqual(totals.ageing);
  });

  it("gives another organisation an empty strip, never this one's money", async () => {
    const a = await setup();
    const b = await setup();
    await a.mk("ISO-1", 1000, "2026-11-01");
    const other = await listInvoices(b.finance, {}, {}, NOW);
    expect(other.total).toBe(0);
    expect(Object.values(other.totals.ageing).every((x) => x.count === 0 && x.outstanding === "0.00")).toBe(true);
  });

  it("refuses the list, the invoice and the export to every role that is not Finance or Management", async () => {
    const { sales, delivery, technical, finance, management, mk } = await setup();
    const inv = await mk("R-1", 100, "2026-12-01");
    for (const who of [sales, delivery, technical]) {
      await expect(listInvoices(who, {}, {}, NOW)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getInvoice(who, inv.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(exportInvoicesCsv(who, {}, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await listInvoices(management, {}, {}, NOW)).total).toBe(1);
    expect((await listInvoices(finance, {}, {}, NOW)).total).toBe(1);
  });

  it("needs invoices.view and finance.export on top of the payment keys", async () => {
    const { finance, mk } = await setup();
    const inv = await mk("K-1", 100, "2026-12-01");
    await expect(listInvoices(without(finance, "invoices.view"), {}, {}, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getInvoice(without(finance, "invoices.view"), inv.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(exportInvoicesCsv(without(finance, "finance.export"), {}, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await exportInvoicesCsv(finance, { amountMin: "50" }, NOW)).split("\n")[1]).toContain("K-1");
  });
});

describe("invoice actions behind the split keys (UC-R9)", () => {
  it("send needs invoices.send, void needs invoices.edit, record and reverse need payments.record", async () => {
    const { finance, mk } = await setup();
    const draft = await mk("S-1", 1000, "2026-12-01", false);
    await expect(markInvoiceSent(without(finance, "invoices.send"), draft.id, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await markInvoiceSent(finance, draft.id, NOW)).status).toBe("SENT");

    await expect(recordPayment(without(finance, "payments.record"), draft.id, { amount: 100 }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await recordPayment(finance, draft.id, { amount: 100, methodLabel: "M-Pesa" }, NOW);
    const detail = await getInvoice(finance, draft.id, NOW);
    const paymentId = (detail.payments[0] as { id: string }).id;
    await expect(reversePayment(without(finance, "payments.record"), paymentId, { reason: "x" }, NOW)).rejects.toBeInstanceOf(ForbiddenError);

    // A void is refused while a payment stands, and is refused without invoices.edit even when it would succeed.
    await expect(voidInvoice(finance, draft.id, { reason: "x" }, NOW)).rejects.toBeInstanceOf(ValidationError);
    await reversePayment(finance, paymentId, { reason: "Entered twice" }, NOW);
    await expect(voidInvoice(without(finance, "invoices.edit"), draft.id, { reason: "x" }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await voidInvoice(finance, draft.id, { reason: "Wrong customer" }, NOW)).status).toBe("VOID");
  });

  it("refuses every action to Sales, Delivery and Restricted Technical", async () => {
    const { sales, delivery, technical, mk } = await setup();
    const inv = await mk("N-1", 1000, "2026-12-01", false);
    for (const who of [sales, delivery, technical]) {
      await expect(markInvoiceSent(who, inv.id, NOW)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(recordPayment(who, inv.id, { amount: 1 }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(voidInvoice(who, inv.id, { reason: "x" }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});
