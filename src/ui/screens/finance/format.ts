/** Small, pure helpers for the Payments tracker (F3.06). Money arrives from the API as two-decimal strings and is never summed as floats here beyond display. */

export type DealPayState = "NOT_INVOICED" | "AWAITING_PAYMENT" | "OVERDUE" | "PAID_IN_FULL";
export type InvoiceStatus = "DRAFT" | "SENT" | "PART_PAID" | "PAID" | "OVERDUE" | "VOID";

export const STATE_LABEL: Record<DealPayState, string> = {
  OVERDUE: "Overdue",
  AWAITING_PAYMENT: "Awaiting payment",
  NOT_INVOICED: "To invoice",
  PAID_IN_FULL: "Paid in full",
};

/** The design's invoice tones: Paid green, Sent blue, Overdue red, Not invoiced grey. */
export const STATE_TONE: Record<DealPayState, { bg: string; fg: string }> = {
  OVERDUE: { bg: "var(--red-soft)", fg: "var(--red)" },
  AWAITING_PAYMENT: { bg: "var(--blue-soft)", fg: "var(--blue)" },
  NOT_INVOICED: { bg: "var(--surface-3)", fg: "var(--text-2)" },
  PAID_IN_FULL: { bg: "var(--primary-soft)", fg: "var(--primary-text)" },
};

export const INVOICE_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: "Not invoiced",
  SENT: "Sent",
  PART_PAID: "Part paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
  VOID: "Void",
};

export const INVOICE_TONE: Record<InvoiceStatus, { bg: string; fg: string }> = {
  DRAFT: { bg: "var(--surface-3)", fg: "var(--text-2)" },
  SENT: { bg: "var(--blue-soft)", fg: "var(--blue)" },
  PART_PAID: { bg: "var(--orange-soft)", fg: "var(--orange-text)" },
  PAID: { bg: "var(--primary-soft)", fg: "var(--primary-text)" },
  OVERDUE: { bg: "var(--red-soft)", fg: "var(--red)" },
  VOID: { bg: "var(--surface-3)", fg: "var(--text-3)" },
};

/** "KES 1,250,000" or "KES 1,250,000.50": whole amounts without the cents. */
export function kes(value: string | number | null | undefined, currency = "KES"): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function kesShort(value: string | number | null | undefined, currency = "KES"): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${currency} ${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (abs >= 1_000) return `${currency} ${Math.round(n / 1_000)}k`;
  return `${currency} ${Math.round(n)}`;
}

/** Whole cents, so a column of money adds up exactly. */
export const cents = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 100);
export const fromCents = (c: number) => (c / 100).toFixed(2);

export function day(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: timeZone ?? "UTC" });
}
export function dayShort(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: timeZone ?? "UTC" });
}
