/**
 * The organisation quote tax setting (UC-R5), pure so it can be tested without a screen. The setting is what NEW quotes copy: switching it on,
 * off or changing it never alters a quote that already exists. The rate is typed as a percentage and sent in basis points (16% is 1600).
 */
export type TaxModeValue = "INCLUSIVE" | "EXCLUSIVE";

export interface TaxDraft {
  on: boolean;
  mode: TaxModeValue;
  /** A percentage such as 16 or 16.5. */
  ratePct: number;
  label: string;
}

export interface TaxSettingView {
  mode: TaxModeValue;
  rateBp: number;
  label: string;
}

export const MAX_TAX_LABEL = 20;
export const DEFAULT_TAX_DRAFT: TaxDraft = { on: false, mode: "INCLUSIVE", ratePct: 16, label: "VAT" };

export function toDraft(tax: TaxSettingView | undefined): TaxDraft {
  return tax ? { on: true, mode: tax.mode, ratePct: tax.rateBp / 100, label: tax.label } : DEFAULT_TAX_DRAFT;
}

/** The PATCH value: an object to set the tax, or null to switch it off. */
export function toTaxBody(d: TaxDraft): TaxSettingView | null {
  return d.on ? { mode: d.mode, rateBp: Math.round(d.ratePct * 100), label: d.label.trim() } : null;
}

export function validateTax(d: TaxDraft): string[] {
  if (!d.on) return [];
  const errors: string[] = [];
  const bp = Math.round(d.ratePct * 100);
  if (!Number.isFinite(d.ratePct) || bp < 1 || bp > 10_000) errors.push("The tax rate must be more than 0% and at most 100%.");
  else if (Math.abs(d.ratePct * 100 - bp) > 1e-6) errors.push("Use at most two decimals in the tax rate, for example 16 or 16.5.");
  const label = d.label.trim();
  if (label === "" || label.length > MAX_TAX_LABEL) errors.push(`The tax name is 1 to ${MAX_TAX_LABEL} characters, for example VAT.`);
  return errors;
}

const describe = (d: TaxDraft) => `${d.label.trim() || "tax"} at ${d.ratePct}% (${d.mode === "EXCLUSIVE" ? "added on top of the prices" : "already in the prices"})`;

/** Plain-language effect of a change, shown before it is saved. It always says that quotes already made stay as they are. */
export function taxImpact(saved: TaxDraft, next: TaxDraft): string[] {
  const out: string[] = [];
  if (!saved.on && next.on) out.push(`New quotes will show ${describe(next)}.`);
  else if (saved.on && !next.on) out.push("New quotes will go back to showing no tax line.");
  else if (saved.on && next.on && JSON.stringify(toTaxBody(saved)) !== JSON.stringify(toTaxBody(next))) out.push(`New quotes will show ${describe(next)} (was ${describe(saved)}).`);
  if (out.length > 0) out.push("Quotes that already exist keep the tax terms they were made with. Nothing already sent changes.");
  return out;
}
