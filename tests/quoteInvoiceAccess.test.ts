import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "../src/auth/errors";
import type { AuthContext } from "../src/auth/context";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { listOrganizationAuditLog } from "../src/services/auditLogService";
import { updateInvoiceNumbering } from "../src/services/invoiceSettingsService";
import {
  createInvoice,
  exportInvoicesCsv,
  getInvoice,
  getPaymentAggregates,
  listInvoices,
  listWonDealPayments,
  markInvoiceSent,
  recordPayment,
  reversePayment,
  voidInvoice,
} from "../src/services/paymentService";
import { getQuote, getQuoteSettings, listQuotesPage } from "../src/services/quoteService";
import { getQuoteActivity, openQuoteLink, previewQuote, revokeQuoteShare, sendQuote } from "../src/services/quoteDocumentService";
import { createView, getView, listViews } from "../src/services/savedViewService";
import { commercialWorld } from "./commercialFixtures";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";
import { createWonDeal } from "./helpers/stage3";

/**
 * UC-R11 (FIG-1782): masking, authorisation and tenant isolation for every quote and invoice surface added by UC-R1 to UC-R9.
 * DB-backed (needs the test database). Rule 7: money masked by role, payments only Finance and Management. Rule 8: another
 * organisation gets 404 (or nothing), never data.
 */

const NOW = new Date("2026-11-10T09:00:00.000Z");
const tokenOf = (link: string) => link.slice(link.lastIndexOf("/") + 1);
const without = (ctx: AuthContext, ...keys: string[]): AuthContext => ({ ...ctx, permissionKeys: ctx.permissionKeys.filter((k) => !keys.includes(k)) });

// ---------------------------------------------------------------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------------------------------------------------------------

async function invoiceWorld(label = "R11Inv") {
  const org = await createTestOrganization(label);
  const management = await createTestContext(org.id, "MANAGEMENT");
  const finance = await createTestContext(org.id, "FINANCE");
  const sales = await createTestContext(org.id, "SALES");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
  const deal = await createWonDeal(org.id, sales, { value: 900000 });
  const mk = (number: string, amount = 1000, sent = true) => createInvoice(finance, { number, amount, issuedOn: "2026-11-01", dueOn: "2026-12-01", dealId: deal.id, sent }, NOW);
  return { org, management, finance, sales, delivery, technical, deal, mk };
}

describe("invoice surfaces against every role (UC-R11)", () => {
  it("Sales, Delivery and Restricted Technical are refused on every invoice and payment read and write", async () => {
    const w = await invoiceWorld();
    const inv = await w.mk("MX-1");
    await recordPayment(w.finance, inv.id, { amount: 100 }, NOW);
    const paymentId = (await getInvoice(w.finance, inv.id, NOW)).payments[0]!.id;
    for (const who of [w.sales, w.delivery, w.technical]) {
      await expect(listInvoices(who, {}, {}, NOW)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getInvoice(who, inv.id, NOW)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(exportInvoicesCsv(who, {}, NOW)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getPaymentAggregates(who, NOW)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listWonDealPayments(who, {}, NOW)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(createInvoice(who, { number: "NOPE", amount: 1, issuedOn: "2026-11-01", dueOn: "2026-12-01", dealId: w.deal.id }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(markInvoiceSent(who, inv.id, NOW)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(voidInvoice(who, inv.id, { reason: "x" }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(recordPayment(who, inv.id, { amount: 1 }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(reversePayment(who, paymentId, { reason: "x" }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await adminDb.invoice.count({ where: { organizationId: w.org.id } })).toBe(1);
  });

  it("Management and Finance see the list, the ageing strip, the drawer with its payment history, and the export", async () => {
    const w = await invoiceWorld();
    const inv = await w.mk("OK-1", 5000);
    await recordPayment(w.finance, inv.id, { amount: 2000 }, NOW);
    for (const who of [w.management, w.finance]) {
      const page = await listInvoices(who, {}, {}, NOW);
      expect(page.items.map((i) => i.number)).toEqual(["OK-1"]);
      expect(page.totals.ageing).toBeDefined();
      const drawer = await getInvoice(who, inv.id, NOW);
      expect(drawer.payments).toHaveLength(1);
      expect(drawer.balance).toBe("3000.00");
      expect(await exportInvoicesCsv(who, {}, NOW)).toContain("OK-1");
      expect((await getPaymentAggregates(who, NOW)) !== null).toBe(true);
    }
  });

  it("a member without the payment key sees no invoice money, even with the split keys (custom-role case)", async () => {
    const w = await invoiceWorld();
    const inv = await w.mk("NOPAY-1");
    // invoices.view / finance.export without finance.view.payments must still give nothing: payments stay behind the old keys.
    const onlySplit = without(w.finance, "finance.view.payments");
    expect(onlySplit.permissionKeys).toContain("invoices.view");
    await expect(listInvoices(onlySplit, {}, {}, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getInvoice(onlySplit, inv.id, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(exportInvoicesCsv(onlySplit, {}, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getPaymentAggregates(onlySplit, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    // And the old key alone is not enough for writes without the split key.
    const noCreate = without(w.finance, "invoices.create");
    await expect(createInvoice(noCreate, { number: "NC-1", amount: 1, issuedOn: "2026-11-01", dueOn: "2026-12-01", dealId: w.deal.id }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the audit log hides invoice rows from a reader without finance.view.payments, and refuses a direct ask for them", async () => {
    const w = await invoiceWorld();
    await w.mk("AUD-1");
    const auditor = without(w.management, "finance.view.payments");
    expect(auditor.permissionKeys).toContain("audit.view");
    const seen = await listOrganizationAuditLog(auditor, {}, { pageSize: 100 });
    expect(seen.items.some((i) => i.entity.type === "Invoice" || i.entity.type === "PaymentRecord")).toBe(false);
    await expect(listOrganizationAuditLog(auditor, { entityType: "Invoice" })).rejects.toBeInstanceOf(ForbiddenError);
    // Control: a reader with the payment key does see them.
    expect((await listOrganizationAuditLog(w.management, { entityType: "Invoice" })).total).toBeGreaterThanOrEqual(1);
  });
});

describe("invoice numbering setting (UC-R11)", () => {
  it("only Management may change it; every other role is refused", async () => {
    const w = await invoiceWorld();
    for (const who of [w.finance, w.sales, w.delivery, w.technical]) await expect(updateInvoiceNumbering(who, { auto: true })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await adminDb.organizationSetting.count({ where: { organizationId: w.org.id, key: "invoices.settings" } })).toBe(0);
  });

  it("is per organisation: switching it on in one organisation changes nothing in another, and its row is invisible across organisations", async () => {
    const a = await invoiceWorld("R11NumA");
    const b = await invoiceWorld("R11NumB");
    await updateInvoiceNumbering(a.management, { auto: true, prefix: "AAA-" });
    const first = await createInvoice(a.finance, { amount: 1, issuedOn: "2026-11-01", dueOn: "2026-12-01", companyId: a.deal.companyId }, NOW);
    expect(first.number).toBe("AAA-0001");
    // B never set it: auto-numbering is off there.
    await expect(createInvoice(b.finance, { amount: 1, issuedOn: "2026-11-01", dueOn: "2026-12-01", companyId: b.deal.companyId }, NOW)).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "NUMBER_REQUIRED" })] });
    // B switching it on starts at its own 0001 whatever A has used.
    await updateInvoiceNumbering(b.management, { auto: true });
    expect((await createInvoice(b.finance, { amount: 1, issuedOn: "2026-11-01", dueOn: "2026-12-01", companyId: b.deal.companyId }, NOW)).number).toBe("INV-0001");
    // Row-level security: from B's context A's setting row cannot be read.
    const seen = await withOrgContext(b.org.id, (tx) => tx.organizationSetting.findMany({ where: { key: "invoices.settings" } }));
    expect(seen.every((r) => r.organizationId === b.org.id)).toBe(true);
    expect(seen.map((r) => r.organizationId)).not.toContain(a.org.id);
  });

  it("the setting is readable through the quote settings only by someone who may read quotes (Delivery and Restricted Technical: refused)", async () => {
    const w = await commercialWorld();
    const delivery = await createTestContext(w.org.id, "DELIVERY");
    const technical = await createTestContext(w.org.id, "RESTRICTED_TECHNICAL");
    await expect(getQuoteSettings(delivery)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getQuoteSettings(technical)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await getQuoteSettings(w.management)).toBeDefined();
  });
});

describe("invoices across organisations (UC-R11)", () => {
  it("another organisation's Finance and Management get 404 on every invoice id, and cannot link its deals or companies", async () => {
    const a = await invoiceWorld("R11IsoA");
    const b = await invoiceWorld("R11IsoB");
    const inv = await a.mk("ISO-A1", 7000);
    await recordPayment(a.finance, inv.id, { amount: 1000 }, NOW);
    const paymentId = (await getInvoice(a.finance, inv.id, NOW)).payments[0]!.id;
    for (const who of [b.finance, b.management]) {
      await expect(getInvoice(who, inv.id, NOW)).rejects.toBeInstanceOf(NotFoundError);
      await expect(markInvoiceSent(who, inv.id, NOW)).rejects.toBeInstanceOf(NotFoundError);
      await expect(voidInvoice(who, inv.id, { reason: "x" }, NOW)).rejects.toBeInstanceOf(NotFoundError);
      await expect(recordPayment(who, inv.id, { amount: 1 }, NOW)).rejects.toBeInstanceOf(NotFoundError);
      await expect(reversePayment(who, paymentId, { reason: "x" }, NOW)).rejects.toBeInstanceOf(NotFoundError);
      await expect(createInvoice(who, { number: "X-DEAL", amount: 1, issuedOn: "2026-11-01", dueOn: "2026-12-01", dealId: a.deal.id }, NOW)).rejects.toBeInstanceOf(NotFoundError);
      await expect(createInvoice(who, { number: "X-CO", amount: 1, issuedOn: "2026-11-01", dueOn: "2026-12-01", companyId: a.deal.companyId }, NOW)).rejects.toBeInstanceOf(NotFoundError);
      const list = await listInvoices(who, {}, {}, NOW);
      expect(list.total).toBe(0);
      expect(list.totals.ageing.d1_30.outstanding).toBe("0.00");
      expect((await exportInvoicesCsv(who, {}, NOW)).includes("ISO-A1")).toBe(false);
      expect((await listWonDealPayments(who, {}, NOW)).items.some((d) => (d as { dealId?: string }).dealId === a.deal.id)).toBe(false);
    }
    // Nothing of A's changed.
    const after = await getInvoice(a.finance, inv.id, NOW);
    expect(after.status).not.toBe("VOID");
    expect(after.payments).toHaveLength(1);
    expect(await adminDb.invoice.count({ where: { organizationId: b.org.id } })).toBe(0);
  });

  it("row-level security hides invoices and payments from another organisation's database context", async () => {
    const a = await invoiceWorld("R11RlsA");
    const b = await invoiceWorld("R11RlsB");
    const inv = await a.mk("RLS-A1");
    await recordPayment(a.finance, inv.id, { amount: 10 }, NOW);
    expect(await withOrgContext(b.org.id, (tx) => tx.invoice.findMany({ where: { id: inv.id } }))).toEqual([]);
    expect(await withOrgContext(b.org.id, (tx) => tx.paymentRecord.findMany({ where: { invoiceId: inv.id } }))).toEqual([]);
    expect(await withOrgContext(a.org.id, (tx) => tx.invoice.findMany({ where: { id: inv.id } }))).toHaveLength(1);
  });

  it("the audit log of another organisation never shows these invoices", async () => {
    const a = await invoiceWorld("R11AudA");
    const b = await invoiceWorld("R11AudB");
    await a.mk("AUDX-1");
    const page = await listOrganizationAuditLog(b.management, { entityType: "Invoice" });
    expect(page.items.some((i) => i.entity.label === "AUDX-1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------------------------------------------------------------

async function quoteWorld() {
  const w = await commercialWorld();
  const { createQuote } = await import("../src/services/quoteService");
  const delivery = await createTestContext(w.org.id, "DELIVERY");
  const technical = await createTestContext(w.org.id, "RESTRICTED_TECHNICAL");
  const quote = (await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 2 }] })).quote;
  return { ...w, delivery, technical, quote };
}

describe("quote surfaces against every role (UC-R11)", () => {
  it("Delivery and Restricted Technical are refused on the list, the quote, the document, the activity and the send", async () => {
    const w = await quoteWorld();
    for (const who of [w.delivery, w.technical]) {
      await expect(listQuotesPage(who)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getQuote(who, w.quote.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(previewQuote(who, w.quote.id, 1)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getQuoteActivity(who, w.quote.id, 1)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(sendQuote(who, w.quote.id, 1, { channel: "link" })).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await adminDb.quoteShare.count({ where: { organizationId: w.org.id } })).toBe(0);
  });

  it("Management sees every quote, Sales only quotes on its own deals, and a salesperson's other deal's quote is a 404", async () => {
    const w = await quoteWorld();
    expect((await listQuotesPage(w.management)).items.map((i) => i.id)).toEqual([w.quote.id]);
    expect((await listQuotesPage(w.sales)).items.map((i) => i.id)).toEqual([w.quote.id]);
    expect((await listQuotesPage(w.salesTwo)).items).toEqual([]);
    await expect(getQuote(w.salesTwo, w.quote.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(previewQuote(w.salesTwo, w.quote.id, 1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getQuoteActivity(w.salesTwo, w.quote.id, 1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(sendQuote(w.salesTwo, w.quote.id, 1, { channel: "link" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("Finance reads the quote document and activity of a won deal, cannot send or revoke, and without the deal-value right gets no document and no signature record", async () => {
    const w = await quoteWorld();
    const shared = await sendQuote(w.sales, w.quote.id, 1, { channel: "link" });
    await adminDb.deal.update({ where: { id: w.deal.id }, data: { outcome: "WON", wonAt: new Date() } });
    expect((await previewQuote(w.finance, w.quote.id, 1)).html).toContain(w.quote.number);
    expect((await getQuoteActivity(w.finance, w.quote.id, 1)).shares).toHaveLength(1);
    await expect(sendQuote(w.finance, w.quote.id, 1, { channel: "link" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(revokeQuoteShare(w.finance, w.quote.id, shared.share.id)).rejects.toBeInstanceOf(ForbiddenError);
    const blind = without(w.finance, "deals.view.value");
    await expect(previewQuote(blind, w.quote.id, 1)).rejects.toBeInstanceOf(ForbiddenError);
    const activity = await getQuoteActivity(blind, w.quote.id, 1);
    expect(activity.signatures).toBeNull();
    expect(activity.signaturesMasked).toBe(true);
    // The activity never carries the link token.
    expect(JSON.stringify(activity)).not.toContain(tokenOf(shared.link));
  });

  it("the quote list never carries a total for a role without the deal-value right, whatever it asks for (counts, activity, search)", async () => {
    const w = await quoteWorld();
    await adminDb.deal.update({ where: { id: w.deal.id }, data: { outcome: "WON", wonAt: new Date() } });
    const blind = without(w.finance, "deals.view.value");
    const page = await listQuotesPage(blind, { q: w.quote.number, counts: true, activity: true });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.latest).toMatchObject({ amountMasked: true, total: null, subtotal: null, discountAmount: null });
    // 2 cameras at 18,500 would be 37,000 if it leaked.
    expect(JSON.stringify(page)).not.toMatch(/37000|37,000/);
    // The owner of the deal always sees its amounts.
    const own = await listQuotesPage(without(w.sales, "deals.view.value"));
    expect(own.items[0]!.latest).toMatchObject({ amountMasked: false });
  });

  it("a revoked share link stops opening, and a link needs no login but does not reveal another quote", async () => {
    const w = await quoteWorld();
    const sent = await sendQuote(w.sales, w.quote.id, 1, { channel: "link" });
    expect((await openQuoteLink(tokenOf(sent.link), { userAgent: "ua" })).status).toBe("ok");
    await revokeQuoteShare(w.management, w.quote.id, sent.share.id);
    expect((await openQuoteLink(tokenOf(sent.link), { userAgent: "ua" })).status).not.toBe("ok");
    expect((await openQuoteLink("not-a-real-token-0000000000000000", { userAgent: "ua" })).status).not.toBe("ok");
  });
});

describe("quote saved views (UC-R11)", () => {
  it("need quotes.view: Delivery and Restricted Technical cannot save one; a private view is invisible to a colleague", async () => {
    const w = await quoteWorld();
    await expect(createView(w.delivery, { entity: "quotes", name: "Nope" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createView(w.technical, { entity: "quotes", name: "Nope" })).rejects.toBeInstanceOf(ForbiddenError);
    const mine = await createView(w.sales, { entity: "quotes", name: "My sent", filters: { tab: "SENT" } });
    const id = (mine as { id: string }).id;
    expect((await listViews(w.salesTwo, { entity: "quotes" })).items.map((v) => v.id)).not.toContain(id);
    expect((await listViews(w.sales, { entity: "quotes" })).items.map((v) => v.id)).toContain(id);
  });

  it("another organisation neither lists nor opens a view", async () => {
    const a = await quoteWorld();
    const b = await quoteWorld();
    const view = (await createView(a.management, { entity: "quotes", name: "A only", scope: "SHARED" })) as { id: string };
    expect((await listViews(b.management, { entity: "quotes" })).items.map((v) => v.id)).not.toContain(view.id);
    await expect(getView(b.management, view.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("quotes across organisations (UC-R11)", () => {
  it("another organisation's Management gets 404 on every quote id and an empty list, and cannot revoke a link", async () => {
    const a = await quoteWorld();
    const b = await quoteWorld();
    const sent = await sendQuote(a.sales, a.quote.id, 1, { channel: "link" });
    await expect(getQuote(b.management, a.quote.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(previewQuote(b.management, a.quote.id, 1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getQuoteActivity(b.management, a.quote.id, 1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(sendQuote(b.management, a.quote.id, 1, { channel: "link" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(revokeQuoteShare(b.management, a.quote.id, sent.share.id)).rejects.toBeInstanceOf(NotFoundError);
    const list = await listQuotesPage(b.management, { q: a.quote.number, counts: true });
    expect(list.items.map((i) => i.id)).not.toContain(a.quote.id);
    expect(list.items.every((i) => i.id !== a.quote.id)).toBe(true);
    expect((await listQuotesPage(b.management, { companyId: a.company.id })).items).toEqual([]);
    // A's link still works: nothing was revoked.
    expect((await openQuoteLink(tokenOf(sent.link), { userAgent: "ua" })).status).toBe("ok");
  });

  it("row-level security hides quote shares and versions from another organisation's database context", async () => {
    const a = await quoteWorld();
    const b = await quoteWorld();
    const sent = await sendQuote(a.sales, a.quote.id, 1, { channel: "link" });
    expect(await withOrgContext(b.org.id, (tx) => tx.quoteShare.findMany({ where: { id: sent.share.id } }))).toEqual([]);
    expect(await withOrgContext(b.org.id, (tx) => tx.quoteVersion.findMany({ where: { quoteId: a.quote.id } }))).toEqual([]);
    expect(await withOrgContext(a.org.id, (tx) => tx.quoteShare.findMany({ where: { id: sent.share.id } }))).toHaveLength(1);
  });
});
