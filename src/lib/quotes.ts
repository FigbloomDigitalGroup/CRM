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

export function computeTotals(lines: readonly TotalsLine[], discountPercent: number): QuoteTotalsResult {
  let subtotalCents = 0;
  let costCents = 0;
  let costKnown = true;
  for (const l of lines) {
    subtotalCents += Math.round(l.quantity * toCents(l.unitPrice));
    if (l.unitCost === null) costKnown = false;
    else costCents += Math.round(l.quantity * toCents(l.unitCost));
  }
  const discountCents = Math.round((subtotalCents * discountPercent) / 100);
  return {
    subtotal: fromCents(subtotalCents),
    discountAmount: fromCents(discountCents),
    total: fromCents(subtotalCents - discountCents),
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
