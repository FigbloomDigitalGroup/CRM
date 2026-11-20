import { describe, expect, it } from "vitest";
import { DEFAULT_TAX_DRAFT, taxImpact, toDraft, toTaxBody, validateTax, type TaxDraft } from "../src/ui/screens/settingsplus/quoteTaxModel";

/** UC-R5: the quote tax editor's pure model. The rate is typed as a percentage and sent in basis points; the impact always says existing quotes stay. */

const on = (p: Partial<TaxDraft> = {}): TaxDraft => ({ ...DEFAULT_TAX_DRAFT, on: true, ...p });

describe("quote tax setting model", () => {
  it("an absent setting is off, and off sends null", () => {
    expect(toDraft(undefined)).toEqual(DEFAULT_TAX_DRAFT);
    expect(DEFAULT_TAX_DRAFT.on).toBe(false);
    expect(toTaxBody(DEFAULT_TAX_DRAFT)).toBeNull();
  });

  it("converts between percent and basis points without drifting", () => {
    expect(toDraft({ mode: "EXCLUSIVE", rateBp: 1650, label: "GST" })).toEqual({ on: true, mode: "EXCLUSIVE", ratePct: 16.5, label: "GST" });
    expect(toTaxBody(on({ ratePct: 16.5, mode: "EXCLUSIVE", label: " GST " }))).toEqual({ mode: "EXCLUSIVE", rateBp: 1650, label: "GST" });
    expect(toTaxBody(on({ ratePct: 16.1 }))?.rateBp).toBe(1610);
    expect(toTaxBody(on({ ratePct: 0.07 }))?.rateBp).toBe(7);
  });

  it("refuses a rate outside 0 to 100, more than two decimals, and a bad name; says nothing while off", () => {
    expect(validateTax(on())).toEqual([]);
    expect(validateTax(on({ ratePct: 0 }))).toHaveLength(1);
    expect(validateTax(on({ ratePct: -3 }))).toHaveLength(1);
    expect(validateTax(on({ ratePct: 100.01 }))).toHaveLength(1);
    expect(validateTax(on({ ratePct: Number.NaN }))).toHaveLength(1);
    expect(validateTax(on({ ratePct: 16.123 }))).toHaveLength(1);
    expect(validateTax(on({ ratePct: 100 }))).toEqual([]);
    expect(validateTax(on({ label: "   " }))).toHaveLength(1);
    expect(validateTax(on({ label: "x".repeat(21) }))).toHaveLength(1);
    expect(validateTax({ ...DEFAULT_TAX_DRAFT, on: false, ratePct: -5, label: "" })).toEqual([]);
  });

  it("describes the effect and always says that existing quotes keep their terms", () => {
    const off = DEFAULT_TAX_DRAFT;
    expect(taxImpact(off, off)).toEqual([]);
    expect(taxImpact(off, on())).toEqual(["New quotes will show VAT at 16% (already in the prices).", "Quotes that already exist keep the tax terms they were made with. Nothing already sent changes."]);
    expect(taxImpact(on(), on({ mode: "EXCLUSIVE" }))[0]).toBe("New quotes will show VAT at 16% (added on top of the prices) (was VAT at 16% (already in the prices)).");
    expect(taxImpact(on(), off)[0]).toBe("New quotes will go back to showing no tax line.");
    expect(taxImpact(on(), on())).toEqual([]);
    for (const [a, b] of [[off, on()], [on(), off], [on(), on({ ratePct: 8 })]] as const) expect(taxImpact(a, b).at(-1)).toMatch(/already exist keep/);
  });
});
