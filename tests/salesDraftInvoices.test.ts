import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { createInvoice, exportInvoicesCsv, getInvoice, listInvoices, markInvoiceSent, recordPayment, updateInvoice } from "../src/services/paymentService";
import { updateSalesDraftInvoices } from "../src/services/invoiceSettingsService";
import { adminDb } from "../src/db/adminClient";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";
import { createWonDeal } from "./helpers/stage3";

/**
 * UC-R10 (FIG-1781): Sales draft-only invoice access, off by default. DB-backed. NOT RUN when written (the shared test database was busy).
 * Covers: the role matrix with the setting off and on, own-deal scoping, no send, no payment, masking (no payment data in any Sales response),
 * and the setting itself (Management only, audited, off by default).
 */
const base = { amount: 1000, issuedOn: "2026-11-01", dueOn: "2026-12-01" };

async function setup() {
  const org = await createTestOrganization("SalesDraft");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const finance = await createTestContext(org.id, "FINANCE");
  const sales = await createTestContext(org.id, "SALES");
  const otherSales = await createTestContext(org.id, "SALES");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
  const mine = await createWonDeal(org.id, sales, { value: 500000 });
  const theirs = await createWonDeal(org.id, otherSales, { value: 700000 });
  return { org, management, finance, sales, otherSales, delivery, technical, mine, theirs };
}

describe("Sales draft invoices (UC-R10)", () => {
  it("is off by default: Sales cannot create, list or read, and the setting is audited when switched", async () => {
    const w = await setup();
    await expect(createInvoice(w.sales, { ...base, number: "S-1", dealId: w.mine.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listInvoices(w.sales)).rejects.toBeInstanceOf(ForbiddenError);
    const fin = await createInvoice(w.finance, { ...base, number: "F-1", dealId: w.mine.id });
    await expect(getInvoice(w.sales, fin.id)).rejects.toBeInstanceOf(ForbiddenError);
    await updateSalesDraftInvoices(w.management, true);
    await updateSalesDraftInvoices(w.management, false);
    const events = await adminDb.auditEvent.findMany({ where: { organizationId: w.org.id, action: "invoice_sales_draft.updated" } });
    expect(events).toHaveLength(2);
    await expect(createInvoice(w.sales, { ...base, number: "S-2", dealId: w.mine.id })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only Management changes the setting", async () => {
    const w = await setup();
    for (const who of [w.sales, w.finance, w.delivery, w.technical]) await expect(updateSalesDraftInvoices(who, true)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateSalesDraftInvoices(w.management, "yes")).rejects.toBeInstanceOf(ValidationError);
  });

  it("with the setting on, Sales creates a draft for an own won deal and gets back only the whitelisted fields", async () => {
    const w = await setup();
    await updateSalesDraftInvoices(w.management, true);
    const made = (await createInvoice(w.sales, { ...base, number: "S-3", dealId: w.mine.id })) as unknown as Record<string, unknown>;
    expect(made).toMatchObject({ number: "S-3", status: "DRAFT", amount: "1000.00", salesDraftOnly: true });
    for (const k of ["paidAmount", "balance", "overdue", "daysOverdue", "overpaid", "payments", "storedStatus"]) expect(made).not.toHaveProperty(k);
    const row = await adminDb.invoice.findFirstOrThrow({ where: { id: made.id as string } });
    expect(row.status).toBe("DRAFT");
    expect(row.createdByMembershipId).toBe(w.sales.membershipId);
  });

  it("refuses Sales a sent invoice, no deal, and someone else's deal", async () => {
    const w = await setup();
    await updateSalesDraftInvoices(w.management, true);
    await expect(createInvoice(w.sales, { ...base, number: "S-4", dealId: w.mine.id, sent: true })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "SALES_DRAFT_ONLY" })] });
    await expect(createInvoice(w.sales, { ...base, number: "S-5", companyId: w.mine.companyId })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "SALES_DRAFT_NEEDS_DEAL" })] });
    await expect(createInvoice(w.sales, { ...base, number: "S-6", dealId: w.theirs.id })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps every other role as before, with the setting on", async () => {
    const w = await setup();
    await updateSalesDraftInvoices(w.management, true);
    for (const who of [w.delivery, w.technical]) {
      await expect(createInvoice(who, { ...base, number: "X-1", dealId: w.mine.id })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listInvoices(who)).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await createInvoice(w.finance, { ...base, number: "X-2", dealId: w.mine.id })).status).toBe("DRAFT");
    expect((await listInvoices(w.finance)).items.length).toBeGreaterThan(0);
  });

  it("shows Sales only the drafts of their own deals; sent, paid and other people's invoices are absent or not found", async () => {
    const w = await setup();
    await updateSalesDraftInvoices(w.management, true);
    const own = (await createInvoice(w.sales, { ...base, number: "O-1", dealId: w.mine.id })) as unknown as { id: string };
    const others = await createInvoice(w.finance, { ...base, number: "O-2", dealId: w.theirs.id });
    const sent = await createInvoice(w.finance, { ...base, number: "O-3", dealId: w.mine.id });
    await markInvoiceSent(w.finance, sent.id);
    await recordPayment(w.finance, sent.id, { amount: 100, paidOn: "2026-11-05" });
    const list = await listInvoices(w.sales);
    expect(list.items.map((i) => (i as { number: string }).number)).toEqual(["O-1"]);
    expect(list).not.toHaveProperty("totals");
    expect((await listInvoices(w.sales, { status: "PAID" })).items).toHaveLength(1); // the status filter cannot widen the view
    expect(await getInvoice(w.sales, own.id)).toMatchObject({ number: "O-1" });
    await expect(getInvoice(w.sales, others.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getInvoice(w.sales, sent.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(JSON.stringify(list)).not.toMatch(/balance|overdue|paidAmount|"payments"/);
  });

  it("gives Sales no send, no payment, no edit and no export", async () => {
    const w = await setup();
    await updateSalesDraftInvoices(w.management, true);
    const own = (await createInvoice(w.sales, { ...base, number: "N-1", dealId: w.mine.id })) as unknown as { id: string };
    await expect(markInvoiceSent(w.sales, own.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(recordPayment(w.sales, own.id, { amount: 10, paidOn: "2026-11-05" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateInvoice(w.sales, own.id, { amount: 5 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(exportInvoicesCsv(w.sales)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("does not change what Finance and Management see (full view with payments)", async () => {
    const w = await setup();
    await updateSalesDraftInvoices(w.management, true);
    const inv = await createInvoice(w.finance, { ...base, number: "FM-1", dealId: w.mine.id });
    expect(await getInvoice(w.finance, inv.id)).toHaveProperty("balance");
    expect(await getInvoice(w.management, inv.id)).toHaveProperty("payments");
  });
});
