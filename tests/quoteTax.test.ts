import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import { renderQuoteHtml, type QuoteDocumentInput } from "../src/lib/quoteDocument";
import { computeTotals, quoteTaxAmount, quoteTaxOf, taxCents, type QuoteTax } from "../src/lib/quotes";
import { getVersionWithLines } from "../src/repositories/quotes";
import { previewQuote } from "../src/services/quoteDocumentService";
import { createNewVersion, createQuote, getQuoteSettings, presentVersion, transitionVersion, updateDraftVersion, updateQuoteSettings } from "../src/services/quoteService";
import { commercialWorld } from "./commercialFixtures";

/**
 * UC-R5 (FIG-1798): tax on quotes. Quotes made before tax existed are worked out and shown exactly as before; a quote made after an organisation
 * switches the setting on carries a frozen copy of it and shows tax lines and totals. Money maths in cents; the tax amount is masked like the total.
 */

const VAT16_EXCLUSIVE: QuoteTax = { mode: "EXCLUSIVE", rateBp: 1600, label: "VAT" };
const VAT16_INCLUSIVE: QuoteTax = { mode: "INCLUSIVE", rateBp: 1600, label: "VAT" };
const line = (quantity: number, unitPrice: number, taxable = true) => ({ quantity, unitPrice, unitCost: null, taxable });

// Custom lines need catalogue.manage, so the seller in these tests also manages the catalogue (as tests/quotes.test.ts does).
const withCatalogue = <T extends { permissionKeys: string[] }>(ctx: T): T => ({ ...ctx, permissionKeys: [...ctx.permissionKeys, "catalogue.manage"] });

async function issuesOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ValidationError) return err.issues ?? [];
    throw err;
  }
  throw new Error("Expected the call to be rejected.");
}

describe("quote tax maths (UC-R5)", () => {
  it("leaves every quote without tax exactly as it was: same totals, taxable flags ignored, no extra keys", () => {
    const lines = [line(12, 18500), line(1, 65000), line(1, 95000, false)];
    const before = { subtotal: 382000, discountAmount: 30560, total: 351440, costTotal: null };
    expect(computeTotals(lines, 8)).toEqual(before);
    expect(computeTotals(lines, 8, null)).toEqual(before);
    expect(computeTotals(lines.map((l) => ({ ...l, taxable: true })), 8)).toEqual(before);
    expect(Object.keys(computeTotals(lines, 8)).sort()).toEqual(["costTotal", "discountAmount", "subtotal", "total"]);
  });

  it("INCLUSIVE: the total does not change and the tax is the part of it that is tax", () => {
    const t = computeTotals([line(1, 1000)], 0, VAT16_INCLUSIVE);
    expect(t.total).toBe(1000);
    expect(quoteTaxAmount([{ lineTotal: 1000, taxable: true }], 0, VAT16_INCLUSIVE)).toBe(137.93); // 1000 x 1600 / 11600
  });

  it("EXCLUSIVE: the tax is added on top of the discounted price", () => {
    expect(computeTotals([line(1, 1000)], 0, VAT16_EXCLUSIVE).total).toBe(1160);
    // 10% discount: tax on 900 is 144.
    const t = computeTotals([line(1, 1000)], 10, VAT16_EXCLUSIVE);
    expect(t).toMatchObject({ subtotal: 1000, discountAmount: 100, total: 1044 });
    expect(quoteTaxAmount([{ lineTotal: 1000, taxable: true }], 10, VAT16_EXCLUSIVE)).toBe(144);
  });

  it("only taxable lines carry tax, and the discount is shared across them in proportion", () => {
    const mixed = [line(1, 1000), line(1, 500, false)];
    expect(computeTotals(mixed, 0, VAT16_EXCLUSIVE).total).toBe(1660);
    expect(computeTotals(mixed, 0, VAT16_INCLUSIVE).total).toBe(1500);
    expect(quoteTaxAmount([{ lineTotal: 1000, taxable: true }, { lineTotal: 500, taxable: false }], 0, VAT16_INCLUSIVE)).toBe(137.93);
    // 100 taxable + 100 not, 10% off: tax on 90 is 14.40, total 200 - 20 + 14.40.
    expect(computeTotals([line(1, 100), line(1, 100, false)], 10, VAT16_EXCLUSIVE).total).toBe(194.4);
    expect(computeTotals([line(1, 500, false)], 0, VAT16_EXCLUSIVE).total).toBe(500);
  });

  it("rounds in whole cents with basis points", () => {
    // 3 x 33.33 = 99.99; 16% of 9999 cents is 1599.84, rounded to 1600 cents.
    expect(taxCents(9999, 0, VAT16_EXCLUSIVE)).toBe(1600);
    expect(computeTotals([line(3, 33.33)], 0, VAT16_EXCLUSIVE).total).toBe(115.99);
    expect(taxCents(10000, 0, { mode: "EXCLUSIVE", rateBp: 1650, label: "VAT" })).toBe(1650);
    expect(taxCents(10000, 0, { mode: "EXCLUSIVE", rateBp: 1, label: "VAT" })).toBe(1);
    expect(taxCents(0, 0, VAT16_EXCLUSIVE)).toBe(0);
  });

  it("a version without a rate has no tax, whatever its mode says (this is every quote made before tax)", () => {
    expect(quoteTaxOf({ taxMode: "INCLUSIVE", taxRateBp: null, taxLabel: null })).toBeNull();
    expect(quoteTaxOf({ taxMode: "EXCLUSIVE", taxRateBp: undefined })).toBeNull();
    expect(quoteTaxOf({ taxMode: "EXCLUSIVE", taxRateBp: 1600, taxLabel: "GST" })).toEqual({ mode: "EXCLUSIVE", rateBp: 1600, label: "GST" });
    expect(quoteTaxOf({ taxMode: "NONSENSE", taxRateBp: 800, taxLabel: " " })).toEqual({ mode: "INCLUSIVE", rateBp: 800, label: "VAT" });
    expect(quoteTaxAmount([{ lineTotal: 1000, taxable: true }], 0, null)).toBeNull();
  });
});

describe("quote document with tax (UC-R5)", () => {
  const base: QuoteDocumentInput = {
    organization: { name: "Acme", phone: null, website: null, address: null, accent: "#1f6f4a", showLogo: false },
    quote: {
      number: "Q-2026-0001",
      version: 1,
      currency: "KES",
      issuedOn: "2026-11-20",
      validUntil: "2026-12-20",
      terms: null,
      discountPercent: 0,
      subtotal: 1000,
      discountAmount: 0,
      total: 1000,
      lines: [{ description: "Survey", unit: "visit", quantity: 1, unitPrice: 1000, lineTotal: 1000, taxable: true }],
    },
    preparedFor: { company: "Beta", contact: null },
    preparedBy: null,
  };
  const withTax = (tax: NonNullable<QuoteDocumentInput["quote"]["tax"]>, total: number): QuoteDocumentInput => ({ ...base, quote: { ...base.quote, total, tax } });

  it("a quote without tax is rendered with no tax rows and the old note", () => {
    const html = renderQuoteHtml(base);
    expect(html).toContain("Prices include VAT where it applies.");
    expect(html).not.toMatch(/Total before|Total includes|is added to the total/);
  });

  it("EXCLUSIVE shows the total before tax, the tax line and the added-on note", () => {
    const html = renderQuoteHtml(withTax({ mode: "EXCLUSIVE", rateBp: 1600, label: "VAT", amount: 160 }, 1160));
    expect(html).toContain("Total before VAT");
    expect(html).toContain("VAT (16%)");
    expect(html).toContain("KES 160.00");
    expect(html).toContain("KES 1,160.00");
    expect(html).toContain("Prices are before VAT. VAT is added to the total.");
    expect(html).not.toContain("Prices include VAT where it applies.");
  });

  it("INCLUSIVE keeps the total and says how much of it is tax", () => {
    const html = renderQuoteHtml(withTax({ mode: "INCLUSIVE", rateBp: 1600, label: "VAT", amount: 137.93 }, 1000));
    expect(html).toContain("Total includes VAT (16%) of");
    expect(html).toContain("KES 137.93");
    expect(html).toContain("Prices include VAT where it applies.");
  });

  it("the tax name is escaped, and a fractional rate is shown as typed", () => {
    const html = renderQuoteHtml(withTax({ mode: "EXCLUSIVE", rateBp: 1650, label: "<b>X</b>", amount: 165 }, 1165));
    expect(html).not.toContain("<b>X</b>");
    expect(html).toContain("&lt;b&gt;X&lt;/b&gt; (16.5%)");
  });

  it("Swahili uses its own tax texts (draft wording, see clientText.ts)", () => {
    const html = renderQuoteHtml({ ...withTax({ mode: "EXCLUSIVE", rateBp: 1600, label: "VAT", amount: 160 }, 1160), language: "sw" });
    expect(html).toContain("Jumla kabla ya VAT");
    expect(html).toContain("VAT kwa 16%");
  });
});

describe("organisation tax setting (UC-R5)", () => {
  it("Management sets it, reads it back, and switches it off; nobody else can change it; bad input is refused", async () => {
    const w = await commercialWorld();
    expect((await getQuoteSettings(w.management)).tax).toBeUndefined();
    expect("tax" in (await getQuoteSettings(w.management))).toBe(false); // the legacy response shape is unchanged while tax is off

    const set = await updateQuoteSettings(w.management, { tax: { mode: "EXCLUSIVE", rateBp: 1600, label: "  VAT  " } });
    expect(set.tax).toEqual({ mode: "EXCLUSIVE", rateBp: 1600, label: "VAT" });
    expect((await getQuoteSettings(w.management)).tax).toEqual({ mode: "EXCLUSIVE", rateBp: 1600, label: "VAT" });
    // Another field changes while the tax stays.
    expect((await updateQuoteSettings(w.management, { validityDays: 14 })).tax).toEqual({ mode: "EXCLUSIVE", rateBp: 1600, label: "VAT" });

    await expect(updateQuoteSettings(w.sales, { tax: { mode: "INCLUSIVE", rateBp: 800 } })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateQuoteSettings(w.finance, { tax: null })).rejects.toBeInstanceOf(ForbiddenError);

    expect((await issuesOf(updateQuoteSettings(w.management, { tax: { mode: "SOMETIMES", rateBp: 1600 } }))).map((i) => i.path)).toContain("tax.mode");
    expect((await issuesOf(updateQuoteSettings(w.management, { tax: { mode: "INCLUSIVE", rateBp: 0 } }))).map((i) => i.path)).toContain("tax.rateBp");
    expect((await issuesOf(updateQuoteSettings(w.management, { tax: { mode: "INCLUSIVE", rateBp: 10001 } }))).map((i) => i.path)).toContain("tax.rateBp");
    expect((await issuesOf(updateQuoteSettings(w.management, { tax: { mode: "INCLUSIVE", rateBp: 15.5 } }))).map((i) => i.path)).toContain("tax.rateBp");
    expect((await issuesOf(updateQuoteSettings(w.management, { tax: { mode: "INCLUSIVE", rateBp: 1600, label: "" } }))).map((i) => i.path)).toContain("tax.label");
    expect((await issuesOf(updateQuoteSettings(w.management, { tax: { mode: "INCLUSIVE", rateBp: 1600, label: "x".repeat(21) } }))).map((i) => i.path)).toContain("tax.label");
    // A refused change leaves the saved setting alone.
    expect((await getQuoteSettings(w.management)).tax?.rateBp).toBe(1600);

    const off = await updateQuoteSettings(w.management, { tax: null });
    expect("tax" in off).toBe(false);
    expect("tax" in (await getQuoteSettings(w.management))).toBe(false);
  });

  it("belongs to one organisation: another organisation neither sees it nor gets tax on its quotes", async () => {
    const a = await commercialWorld();
    const b = await commercialWorld();
    await updateQuoteSettings(a.management, { tax: { mode: "EXCLUSIVE", rateBp: 1600, label: "VAT" } });
    expect("tax" in (await getQuoteSettings(b.management))).toBe(false);
    const created = await createQuote(withCatalogue(b.sales), b.deal.id, { lines: [{ description: "Survey", unit: "visit", quantity: 1, unitPrice: "1000.00" }] });
    expect("taxRateBp" in created.version).toBe(false);
    expect(created.version.total).toBe(1000);
    const aCreated = await createQuote(withCatalogue(a.sales), a.deal.id, { lines: [{ description: "Survey", unit: "visit", quantity: 1, unitPrice: "1000.00" }] });
    expect(aCreated.version.total).toBe(1160);
  });
});

describe("quotes with tax (UC-R5)", () => {
  it("a quote made with no tax setting is exactly what it always was, in the response and in the database", async () => {
    const w = await commercialWorld();
    const created = await createQuote(withCatalogue(w.sales), w.deal.id, {
      lines: [{ description: "Survey", unit: "visit", quantity: 2, unitPrice: "500.00" }, { description: "Parts", unit: "set", quantity: 1, unitPrice: "300.00", taxable: false }],
      discountPercent: 10,
    });
    const v = created.version;
    expect(v).toMatchObject({ subtotal: 1300, discountAmount: 130, total: 1170 });
    for (const key of ["taxMode", "taxRateBp", "taxLabel", "taxAmount"]) expect(key in v, key).toBe(false);
    const row = await adminDb.quoteVersion.findFirstOrThrow({ where: { quoteId: created.quote.id } });
    expect(row.taxRateBp).toBeNull();
    expect(row.taxLabel).toBeNull();
    expect(row.taxMode).toBe("INCLUSIVE"); // the column default, which is what every existing quote reads
  });

  it("a new quote copies the setting, works the tax out on its taxable lines, and freezes it", async () => {
    const w = await commercialWorld();
    await updateQuoteSettings(w.management, { tax: { mode: "EXCLUSIVE", rateBp: 1600, label: "VAT" } });
    const seller = withCatalogue(w.sales);
    const created = await createQuote(seller, w.deal.id, {
      lines: [{ description: "Survey", unit: "visit", quantity: 1, unitPrice: "1000.00" }, { description: "Parts", unit: "set", quantity: 1, unitPrice: "500.00", taxable: false }],
      discountPercent: 10,
    });
    // subtotal 1500, discount 150, taxable 1000 less 10% = 900, tax 144, total 1500 - 150 + 144.
    expect(created.version).toMatchObject({ subtotal: 1500, discountAmount: 150, total: 1494, taxMode: "EXCLUSIVE", taxRateBp: 1600, taxLabel: "VAT", taxAmount: 144 });
    const row = await adminDb.quoteVersion.findFirstOrThrow({ where: { quoteId: created.quote.id } });
    expect([row.taxMode, row.taxRateBp, row.taxLabel, Number(row.total)]).toEqual(["EXCLUSIVE", 1600, "VAT", 1494]);

    // The organisation changes its setting afterwards: this quote keeps its own terms, also when its draft is edited.
    await updateQuoteSettings(w.management, { tax: { mode: "INCLUSIVE", rateBp: 800, label: "GST" } });
    const edited = await updateDraftVersion(seller, created.quote.id, 1, { discountPercent: 0 });
    expect(edited).toMatchObject({ total: 1660, taxMode: "EXCLUSIVE", taxRateBp: 1600, taxLabel: "VAT", taxAmount: 160 });
  });

  it("a locked version cannot have its tax terms changed, and a new version copies them from its source", async () => {
    const w = await commercialWorld();
    await updateQuoteSettings(w.management, { tax: { mode: "INCLUSIVE", rateBp: 1600, label: "VAT" } });
    const seller = withCatalogue(w.sales);
    const created = await createQuote(seller, w.deal.id, { lines: [{ description: "Survey", unit: "visit", quantity: 1, unitPrice: "1000.00" }] });
    expect(created.version).toMatchObject({ total: 1000, taxMode: "INCLUSIVE", taxAmount: 137.93 });
    const row = await adminDb.quoteVersion.findFirstOrThrow({ where: { quoteId: created.quote.id, version: 1 } });
    await transitionVersion(w.org.id, row.id, ["DRAFT"], "PENDING_APPROVAL", { lock: true });
    for (const data of [{ taxRateBp: 1 }, { taxMode: "EXCLUSIVE" }, { taxLabel: "Other" }]) {
      await expect(adminDb.quoteVersion.update({ where: { id: row.id }, data }), JSON.stringify(data)).rejects.toThrow(/locked/i);
    }
    await transitionVersion(w.org.id, row.id, ["PENDING_APPROVAL"], "APPROVED");
    await transitionVersion(w.org.id, row.id, ["APPROVED"], "SENT");
    // The organisation moves on; the next version of this quote still has the terms of the version it came from.
    await updateQuoteSettings(w.management, { tax: null });
    const next = await createNewVersion(seller, created.quote.id);
    expect(next).toMatchObject({ version: 2, total: 1000, taxMode: "INCLUSIVE", taxRateBp: 1600, taxLabel: "VAT", taxAmount: 137.93 });
  });

  it("the database refuses a tax rate or mode that makes no sense", async () => {
    const w = await commercialWorld();
    const created = await createQuote(withCatalogue(w.sales), w.deal.id, { lines: [{ description: "Survey", unit: "visit", quantity: 1, unitPrice: "100.00" }] });
    const row = await adminDb.quoteVersion.findFirstOrThrow({ where: { quoteId: created.quote.id } });
    await expect(adminDb.quoteVersion.update({ where: { id: row.id }, data: { taxRateBp: 10001 } })).rejects.toThrow();
    await expect(adminDb.quoteVersion.update({ where: { id: row.id }, data: { taxRateBp: -1 } })).rejects.toThrow();
    await expect(adminDb.quoteVersion.update({ where: { id: row.id }, data: { taxMode: "MAYBE" } })).rejects.toThrow();
    await expect(adminDb.quoteVersion.update({ where: { id: row.id }, data: { taxLabel: "" } })).rejects.toThrow();
  });
});

describe("tax amounts are masked like the total (UC-R5, rule 7)", () => {
  it("shows the tax to a viewer who may see amounts, and never to one who may not, in the version and in a list summary", async () => {
    const w = await commercialWorld();
    await updateQuoteSettings(w.management, { tax: { mode: "EXCLUSIVE", rateBp: 1600, label: "VAT" } });
    const created = await createQuote(withCatalogue(w.sales), w.deal.id, { lines: [{ description: "Sentinel survey", unit: "visit", quantity: 1, unitPrice: "98765.00" }] });
    const row = (await getVersionWithLines(w.org.id, created.quote.id, 1))!;
    const deal = { ownerMembershipId: w.sales.membershipId };

    const owner = presentVersion(w.sales, deal, row, null);
    expect(owner.taxAmount).toBe(15802.4); // 16% of 98765.00
    expect(owner.total).toBe(114567.4);

    const hidden = presentVersion({ permissionKeys: w.sales.permissionKeys, membershipId: w.sales.membershipId, hiddenFields: ["deal.value"] }, deal, row, null);
    expect(hidden.amountMasked).toBe(true);
    expect(hidden.taxAmount).toBeNull();
    expect(hidden.total).toBeNull();
    // Not the owner and no right to see deal values: masked too. The rate and the name are not money and are still there.
    const stranger = presentVersion({ permissionKeys: [], membershipId: "someone-else" }, deal, row, null);
    expect(stranger.taxAmount).toBeNull();
    expect(stranger.taxRateBp).toBe(1600);
    const serialised = JSON.stringify([hidden, stranger]);
    expect(serialised).not.toMatch(/15[,.]?802|114[,.]?567|98[,.]?765/);

    // A list summary has no lines to work the tax out from: null, never a wrong zero.
    const summary = presentVersion(w.management, deal, { ...row, lines: [] }, null);
    expect(summary.taxAmount).toBeNull();
  });

  it("the margin of an EXCLUSIVE quote is worked out on the price without the tax", async () => {
    const w = await commercialWorld();
    await updateQuoteSettings(w.management, { tax: { mode: "EXCLUSIVE", rateBp: 1600, label: "VAT" } });
    const created = await createQuote(w.management, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 10 }] });
    // 10 cameras: price 185000, cost 110000. Without tax the margin is (185000 - 110000) / 185000 = 41%; with tax counted as revenue it would be 49%.
    expect(created.version.marginPct).toBe(41);
    expect(created.version.total).toBe(214600);
  });
});

describe("quote document service with tax (UC-R5)", () => {
  it("the preview of a quote made with tax shows the tax lines; the preview of a quote without tax is unchanged", async () => {
    const w = await commercialWorld();
    const plain = await createQuote(withCatalogue(w.sales), w.deal.id, { lines: [{ description: "Survey", unit: "visit", quantity: 1, unitPrice: "1000.00" }] });
    const plainPreview = await previewQuote(w.sales, plain.quote.id, 1);
    expect(plainPreview.html).toContain("Prices include VAT where it applies.");
    expect(plainPreview.html).not.toMatch(/Total before|Total includes/);

    const w2 = await commercialWorld();
    await updateQuoteSettings(w2.management, { tax: { mode: "EXCLUSIVE", rateBp: 1600, label: "VAT" } });
    const taxed = await createQuote(withCatalogue(w2.sales), w2.deal.id, { lines: [{ description: "Survey", unit: "visit", quantity: 1, unitPrice: "1000.00" }] });
    const preview = await previewQuote(w2.sales, taxed.quote.id, 1);
    expect(preview.html).toContain("VAT (16%)");
    expect(preview.html).toContain("KES 1,160.00");
  });
});
