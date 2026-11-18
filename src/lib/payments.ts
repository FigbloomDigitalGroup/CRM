/**
 * The arithmetic and status rules of the Payments tracker (FIG-1049, B3.03). Pure: no database, no clock of its own
 * (callers pass `today`), so every rule can be tested with a fixed date.
 *
 * Amounts are kept as integer cents while they are added up, so 0.1 + 0.2 never produces a stray fraction.
 * Nothing here processes money; it only reports where an invoice stands.
 */

export type StoredInvoiceStatus = "DRAFT" | "SENT" | "PART_PAID" | "PAID" | "VOID";
/** What the tracker shows: the stored status, with OVERDUE derived from the due date. */
export type InvoiceStatus = StoredInvoiceStatus | "OVERDUE";

export const INVOICE_STATUSES: readonly InvoiceStatus[] = ["DRAFT", "SENT", "PART_PAID", "PAID", "OVERDUE", "VOID"];

const DAY_MS = 24 * 60 * 60 * 1000;

/** "123.45" or a number or a Decimal-like to whole cents. */
export function toCents(value: { toString(): string } | number | string): number {
  const text = typeof value === "number" ? value.toFixed(2) : value.toString();
  const match = /^(-?)(\d+)(?:\.(\d{1,2})\d*)?$/.exec(text.trim());
  if (!match) throw new Error(`Not an amount: ${text}`);
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0") || "0");
  return match[1] ? -cents : cents;
}

export function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** The calendar day (UTC) of a moment, as a Date at midnight. */
export function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export interface InvoiceFacts {
  status: StoredInvoiceStatus;
  /** Invoice amount in cents. */
  amountCents: number;
  /** Sum of payments that have not been reversed, in cents. */
  paidCents: number;
  dueOn: Date;
}

export interface InvoiceStanding {
  status: InvoiceStatus;
  paidCents: number;
  /** What is still owed; never negative (an overpayment shows as `overpaidCents`). */
  balanceCents: number;
  overpaidCents: number;
  overdue: boolean;
  daysOverdue: number;
}

/**
 * Where an invoice stands on a given day. An invoice is overdue when it has been sent, still has a balance and its
 * due date is before today. Draft, paid and void invoices are never overdue.
 */
export function standingOf(facts: InvoiceFacts, today: Date): InvoiceStanding {
  const balanceCents = Math.max(0, facts.amountCents - facts.paidCents);
  const overpaidCents = Math.max(0, facts.paidCents - facts.amountCents);
  const dueDay = startOfDay(facts.dueOn).getTime();
  const todayDay = startOfDay(today).getTime();
  const collectable = (facts.status === "SENT" || facts.status === "PART_PAID") && balanceCents > 0;
  const overdue = collectable && dueDay < todayDay;
  return {
    status: overdue ? "OVERDUE" : facts.status,
    paidCents: facts.paidCents,
    balanceCents,
    overpaidCents,
    overdue,
    daysOverdue: overdue ? Math.round((todayDay - dueDay) / DAY_MS) : 0,
  };
}

/** The stored status an invoice moves to after its payments change. Draft and void are not touched by payments. */
export function statusAfterPayments(
  current: StoredInvoiceStatus,
  amountCents: number,
  paidCents: number,
): StoredInvoiceStatus {
  if (current === "DRAFT" || current === "VOID") return current;
  if (paidCents >= amountCents) return "PAID";
  if (paidCents > 0) return "PART_PAID";
  return "SENT";
}

export type PaymentCheck =
  | { ok: true; paidCents: number }
  | { ok: false; code: "INVOICE_VOID" | "INVOICE_NOT_SENT" | "OVERPAYMENT"; message: string; maxCents: number };

/**
 * Whether a payment of `paymentCents` may be recorded now. The sum of payments can never exceed the invoice amount
 * unless the person says so explicitly (`allowOverpayment`).
 */
export function checkNewPayment(input: {
  status: StoredInvoiceStatus;
  amountCents: number;
  paidCents: number;
  paymentCents: number;
  allowOverpayment: boolean;
}): PaymentCheck {
  if (input.status === "VOID") {
    return { ok: false, code: "INVOICE_VOID", message: "This invoice is void, so no payment can be recorded on it.", maxCents: 0 };
  }
  if (input.status === "DRAFT") {
    return { ok: false, code: "INVOICE_NOT_SENT", message: "Mark the invoice as sent before recording a payment.", maxCents: 0 };
  }
  const total = input.paidCents + input.paymentCents;
  const room = Math.max(0, input.amountCents - input.paidCents);
  if (total > input.amountCents && !input.allowOverpayment) {
    return {
      ok: false,
      code: "OVERPAYMENT",
      message: `This payment is more than the ${fromCents(room)} still owing. Tick "allow overpayment" if that is intended.`,
      maxCents: room,
    };
  }
  return { ok: true, paidCents: total };
}

/** Days from today to a date: negative when the date has passed. */
export function daysUntil(date: Date, today: Date): number {
  return Math.round((startOfDay(date).getTime() - startOfDay(today).getTime()) / DAY_MS);
}
