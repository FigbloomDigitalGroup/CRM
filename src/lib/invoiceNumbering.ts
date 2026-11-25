/**
 * Invoice numbers (UC-R8, FIG-1779), pure so the rules can be tested without a database.
 *
 * With auto-numbering on, a new invoice without a typed number gets `prefix` plus the next number, padded to four digits (`INV-0001`). The next
 * number is one more than the highest number that has the prefix and is only digits after it; manual numbers that do not fit that shape are
 * ignored, never rewritten. A typed number always wins. Uniqueness is case-insensitive per organisation (the `invoices_org_lower_number_key` index).
 */
export interface InvoiceNumbering {
  auto: boolean;
  prefix: string;
}

export const INVOICE_NUMBER_MAX = 60;
export const INVOICE_PREFIX_MAX = 20;
export const DEFAULT_INVOICE_PREFIX = "INV-";
export const INVOICE_NUMBERING_KEY = "invoices.settings";
export const DEFAULT_INVOICE_NUMBERING: InvoiceNumbering = { auto: false, prefix: DEFAULT_INVOICE_PREFIX };

/** Letters, digits and `- _ . /` only, 1 to 20 characters. Returns the cleaned prefix, or null when it is not allowed. */
export function cleanInvoicePrefix(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9\-_./]{0,19}$/.test(text) ? text : null;
}

export function formatInvoiceNumber(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(4, "0")}`;
}

/** The next sequence number given the numbers already used (any case, any shape). */
export function nextInvoiceSequence(prefix: string, existing: readonly string[]): number {
  const p = prefix.toLowerCase();
  let max = 0;
  for (const raw of existing) {
    const number = raw.trim();
    if (number.length <= p.length || number.slice(0, p.length).toLowerCase() !== p) continue;
    const rest = number.slice(p.length);
    if (/^\d{1,9}$/.test(rest)) max = Math.max(max, Number(rest));
  }
  return max + 1;
}

/** Parses the stored setting; a damaged value means auto-numbering off with the default prefix, never a guess. */
export function parseStoredInvoiceNumbering(raw: unknown): InvoiceNumbering | null {
  if (typeof raw !== "object" || raw === null) return null;
  const v = raw as Record<string, unknown>;
  const prefix = cleanInvoicePrefix(v.prefix) ?? DEFAULT_INVOICE_PREFIX;
  return { auto: v.auto === true, prefix };
}

/** Due date from the issue date and the terms in days (both `YYYY-MM-DD`). The screen uses it to suggest a due date; the API still receives `dueOn`. */
export function dueDateFrom(issuedOn: string, days: number): string {
  const d = new Date(`${issuedOn}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
