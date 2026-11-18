import { zonedTimeToUtc } from "../notifications/timeZone";

/**
 * A follow-up is a date AND a time (P2-27, FIG-1681). The default time of day, used when a client sends only a date
 * (an old client, a CSV import) or when the form offers "tomorrow". Recorded as a decision in docs/DECISIONS.md section 11.
 */
export const DEFAULT_FOLLOW_UP_TIME = "09:00";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateOnly(value: unknown): value is string {
  return typeof value === "string" && DATE_ONLY.test(value.trim());
}

/**
 * The instant a follow-up value means. A full ISO date-time is taken as sent. A date-only value (`2026-11-20`) becomes the default
 * time on that day in the person's own time zone, never midnight UTC. Returns null for "clear", undefined for "not given".
 */
export function resolveFollowUpInstant(value: string | Date | null | undefined, timeZone: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (value instanceof Date) return value;
  const m = DATE_ONLY.exec(value.trim());
  if (m) {
    const [h, mi] = DEFAULT_FOLLOW_UP_TIME.split(":").map(Number) as [number, number];
    return zonedTimeToUtc(Number(m[1]), Number(m[2]), Number(m[3]), h, mi, timeZone);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
