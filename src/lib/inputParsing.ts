import { ValidationError } from "../auth/errors";
import { toCents } from "./payments";

/**
 * Small, strict parsers for the values Stage 3 services accept (dates, money, short text). They throw a
 * `ValidationError` naming the field, so a route never has to word the message itself.
 */

/** A calendar date (`2026-11-30`, or a full ISO timestamp) as midnight UTC. */
export function parseDateOnly(value: unknown, path: string): Date {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const d = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
    if (!Number.isNaN(d.getTime())) return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  throw new ValidationError(`${path} is not a valid date.`, [{ path, message: "Use a date such as 2026-11-30." }]);
}

export function parseOptionalDate(value: unknown, path: string): Date | null {
  return value === undefined || value === null || value === "" ? null : parseDateOnly(value, path);
}

/** A money amount above zero with at most two decimals. Returns whole cents. */
export function parseMoneyCents(value: unknown, path: string, { allowZero = false }: { allowZero?: boolean } = {}): number {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(text)) {
    throw new ValidationError(`${path} is not a valid amount.`, [{ path, message: "Use a number with at most two decimals, such as 25000 or 1250.50." }]);
  }
  const cents = toCents(text);
  if (cents === 0 && !allowZero) {
    throw new ValidationError(`${path} must be more than zero.`, [{ path, message: "Enter an amount above zero." }]);
  }
  return cents;
}

/** Trimmed text of 1..max characters (or null when blank and optional). */
export function cleanText(value: unknown, path: string, max: number, { required = false }: { required?: boolean } = {}): string | null {
  const text = typeof value === "string" ? value.trim().replace(/\s+\n/g, "\n") : "";
  if (!text) {
    if (required) throw new ValidationError(`${path} is required.`, [{ path, message: "This is required." }]);
    return null;
  }
  if (text.length > max) {
    throw new ValidationError(`${path} is longer than ${max} characters.`, [{ path, message: `At most ${max} characters.` }]);
  }
  return text;
}
