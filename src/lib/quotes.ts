import { fromCents, toCents } from "./commercialMoney";

/**
 * Quote arithmetic and rules, pure (FIG-1143, B6.11). Prices include VAT (the quote terms say so), so the total is the
 * subtotal less the discount. All sums are made in whole cents. Nothing here decides anything for a person: a discount above
 * the approval limit makes the send wait for an approver (`approvalRules.ts`), it never changes the quote.
 */

export const MAX_QUOTE_DISCOUNT = 30;
export const DEFAULT_VALIDITY_DAYS = 30;
export const DEFAULT_TERMS = "50% deposit, balance on delivery. Prices include 16% VAT.";
export const MAX_TERMS_LENGTH = 4000;
export const MAX_QUOTE_LINES = 100;

export const QUOTE_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "SENT", "ACCEPTED", "DECLINED"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** Statuses from which the content can no longer change (the database trigger enforces the same). */
export function isLockedStatus(status: string): boolean {
  return status !== "DRAFT";
}

export interface TotalsLine {
  quantity: number;
  unitPrice: number;
  unitCost: number | null;
  /** Whether tax applies to this line (the per-line flag that has always existed). Left out means taxable. Only used when the quote carries tax. */
  taxable?: boolean;
}

/**
 * Tax on a quote (UC-R5). A quote has tax lines only when it carries a rate: an organisation that switched the tax setting on
 * gives its NEW quotes a copy of it (`mode`, `rateBp`, `label`), frozen on the version like the prices. Every quote made before
 * that has no rate and is worked out exactly as before (VAT-inclusive, no tax line).
 *  - INCLUSIVE: prices already contain the tax, so the total does not change; the tax shown is the part of it that is tax.
 *  - EXCLUSIVE: prices are before tax, so the tax is added to the total.
 * `rateBp` is in basis points (1600 = 16%).
 */
export const TAX_MODES = ["INCLUSIVE", "EXCLUSIVE"] as const;
export type TaxMode = (typeof TAX_MODES)[number];
export const MAX_TAX_RATE_BP = 10_000;
export const MAX_TAX_LABEL_LENGTH = 20;
export const DEFAULT_TAX_LABEL = "VAT";

export interface QuoteTax {
  mode: TaxMode;
  rateBp: number;
  label: string;
}

export function isTaxMode(value: unknown): value is TaxMode {
  return typeof value === "string" && (TAX_MODES as readonly string[]).includes(value);
}

/** The tax terms stored on a version, or null for a quote made before tax existed (and for any version without a rate). */
export function quoteTaxOf(v: { taxMode?: string | null; taxRateBp?: number | null; taxLabel?: string | null }): QuoteTax | null {
  if (v.taxRateBp === null || v.taxRateBp === undefined) return null;
  return { mode: isTaxMode(v.taxMode) ? v.taxMode : "INCLUSIVE", rateBp: v.taxRateBp, label: v.taxLabel && v.taxLabel.trim() !== "" ? v.taxLabel : DEFAULT_TAX_LABEL };
}

/**
 * The tax of a quote in whole cents. `taxableLineCents` is the sum of the taxable lines before discount. The discount is
 * shared across the lines in proportion, so the tax is worked out on the taxable lines' share of the discounted price.
 */
export function taxCents(taxableLineCents: number, discountPercent: number, tax: QuoteTax): number {
  const baseCents = taxableLineCents - Math.round((taxableLineCents * discountPercent) / 100);
  return tax.mode === "EXCLUSIVE" ? Math.round((baseCents * tax.rateBp) / 10_000) : Math.round((baseCents * tax.rateBp) / (10_000 + tax.rateBp));
}

/** The tax amount of a stored version: worked out again from its frozen lines, so it can never disagree with them. Null without tax. */
export function quoteTaxAmount(lines: readonly { lineTotal: number; taxable: boolean }[], discountPercent: number, tax: QuoteTax | null): number | null {
  if (tax === null) return null;
  let taxableCents = 0;
  for (const l of lines) if (l.taxable) taxableCents += toCents(l.lineTotal);
  return fromCents(taxCents(taxableCents, discountPercent, tax));
}

export interface QuoteTotalsResult {
  subtotal: number;
  discountAmount: number;
  total: number;
  /** Null when any line has no cost. */
  costTotal: number | null;
}

export function lineTotal(quantity: number, unitPrice: number): number {
  return fromCents(Math.round(quantity * toCents(unitPrice)));
}

export function computeTotals(lines: readonly TotalsLine[], discountPercent: number, tax: QuoteTax | null = null): QuoteTotalsResult {
  let subtotalCents = 0;
  let taxableCents = 0;
  let costCents = 0;
  let costKnown = true;
  for (const l of lines) {
    const lineCents = Math.round(l.quantity * toCents(l.unitPrice));
    subtotalCents += lineCents;
    if (l.taxable !== false) taxableCents += lineCents;
    if (l.unitCost === null) costKnown = false;
    else costCents += Math.round(l.quantity * toCents(l.unitCost));
  }
  const discountCents = Math.round((subtotalCents * discountPercent) / 100);
  // Only an EXCLUSIVE quote adds tax to the total. Without tax (every quote made before UC-R5) the total is the subtotal less the discount, as always.
  const addedTaxCents = tax !== null && tax.mode === "EXCLUSIVE" ? taxCents(taxableCents, discountPercent, tax) : 0;
  return {
    subtotal: fromCents(subtotalCents),
    discountAmount: fromCents(discountCents),
    total: fromCents(subtotalCents - discountCents + addedTaxCents),
    costTotal: lines.length > 0 && costKnown ? fromCents(costCents) : null,
  };
}

/** Margin on the discounted total, a whole percentage; null when the cost is unknown or the total is zero. */
export function quoteMarginPct(total: number, costTotal: number | null): number | null {
  if (costTotal === null || total <= 0) return null;
  return Math.round(((total - costTotal) / total) * 100);
}

/** The date `days` from `from`, as YYYY-MM-DD (UTC). */
export function addDays(from: Date, days: number): string {
  return new Date(from.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** A version is expired once its validity date has passed. */
export function isExpiredOn(validUntil: string, now = new Date()): boolean {
  return validUntil < todayIso(now);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
