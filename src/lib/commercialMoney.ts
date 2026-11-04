import type { ValidationIssue } from "../auth/errors";

/**
 * Money helpers for the commercial area (catalogue, quotes; FIG-1142, FIG-1143). Amounts are held to two decimals and
 * calculated in whole cents so a total never drifts by a fraction.
 */
export const MAX_MONEY = 999_999_999_999;

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

export function round2(amount: number): number {
  return fromCents(toCents(amount));
}

/** Reads a money input (number or "1234.50"); records an issue and returns null when it is not a non-negative amount with at most two decimals. */
export function parseMoney(value: unknown, path: string, issues: ValidationIssue[], label: string): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > MAX_MONEY || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) {
    issues.push({ path, message: `${label} must be an amount of zero or more with at most two decimals.`, code: "INVALID_AMOUNT" });
    return null;
  }
  return round2(n);
}

export function normaliseCurrency(value: unknown, path: string, issues: ValidationIssue[]): string | null {
  const c = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(c)) {
    issues.push({ path, message: "Use a three-letter currency code such as KES.", code: "INVALID_CURRENCY" });
    return null;
  }
  return c;
}
