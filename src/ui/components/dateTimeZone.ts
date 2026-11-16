/**
 * Date and time in a person's own time zone, as plain functions (P2-27, FIG-1681). The follow-up input, the Tasks and Calendar drawers and their
 * tests all use these, so "Thursday 14 Nov at 15:30" means the same instant everywhere: the API stores UTC, the screen reads and writes the person's zone.
 */

export const DEFAULT_TIME = "09:00";
export const MINUTE_STEP = 5;

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const cache = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string | null | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? "";
  let f = cache.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-GB", { timeZone: timeZone ?? undefined, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23", weekday: "short" });
    } catch {
      f = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23", weekday: "short" });
    }
    cache.set(key, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const two = (n: number) => String(n).padStart(2, "0");

/** The wall-clock parts of an instant in a zone. */
export function partsInZone(date: Date, timeZone: string | null | undefined): Parts {
  const o: Partial<Parts> = {};
  for (const p of formatter(timeZone).formatToParts(date)) {
    if (p.type === "year") o.year = Number(p.value);
    else if (p.type === "month") o.month = Number(p.value);
    else if (p.type === "day") o.day = Number(p.value);
    else if (p.type === "hour") o.hour = Number(p.value) % 24;
    else if (p.type === "minute") o.minute = Number(p.value);
    else if (p.type === "weekday") o.weekday = WEEKDAYS[p.value] ?? 0;
  }
  return o as Parts;
}

/** YYYY-MM-DD of an instant in a zone. */
export function dayOf(date: Date, timeZone: string | null | undefined): string {
  const p = partsInZone(date, timeZone);
  return `${p.year}-${two(p.month)}-${two(p.day)}`;
}

/** HH:MM (24 hour) of an instant in a zone. */
export function clockOf(date: Date, timeZone: string | null | undefined): string {
  const p = partsInZone(date, timeZone);
  return `${two(p.hour)}:${two(p.minute)}`;
}

/** The instant at which the wall clock in the zone reads this day and time. Handles a change of offset on that day (daylight saving). */
export function instantAt(day: string, time: string, timeZone: string | null | undefined): Date {
  const [y, mo, d] = day.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let result = guess;
  for (let i = 0; i < 3; i += 1) {
    const p = partsInZone(new Date(result), timeZone);
    result += guess - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  }
  return new Date(result);
}

/** YYYY-MM-DD shifted by whole days (calendar arithmetic, independent of any zone). */
export function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${two(t.getUTCMonth() + 1)}-${two(t.getUTCDate())}`;
}

function weekdayOfDay(day: string): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Rounds a time of day (HH:MM) to the nearest step. 23:58 rounds to 23:55, never past midnight. */
export function snapClock(time: string, step = MINUTE_STEP): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const total = Math.min(23 * 60 + 60 - step, Math.round((h * 60 + m) / step) * step);
  return `${two(Math.floor(total / 60))}:${two(total % 60)}`;
}

/** A clock for a person: "15:30" or "3:30 PM". */
export function clockLabel(time: string, hour12: boolean): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  if (!hour12) return `${two(h)}:${two(m)}`;
  return `${h % 12 || 12}:${two(m)} ${h >= 12 ? "PM" : "AM"}`;
}

/** Every time of the day at the minute step, labelled for the person's clock. */
export function timeOptions(hour12: boolean, step = MINUTE_STEP): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let t = 0; t < 24 * 60; t += step) {
    const value = `${two(Math.floor(t / 60))}:${two(t % 60)}`;
    out.push({ value, label: clockLabel(value, hour12) });
  }
  return out;
}

export interface QuickChoice {
  key: "today" | "tomorrow" | "next-week";
  label: string;
  at: Date;
}

/**
 * The quick choices next to the input: Today 17:00 (offered only while it is still ahead), Tomorrow 09:00 and Next week (Monday 09:00).
 * "Pick a date and time" is the inputs themselves. The times are in the person's zone.
 */
export function quickChoices(now: Date, timeZone: string | null | undefined, hour12 = false, defaultTime = DEFAULT_TIME): QuickChoice[] {
  const today = dayOf(now, timeZone);
  const out: QuickChoice[] = [];
  const evening = instantAt(today, "17:00", timeZone);
  if (evening.getTime() > now.getTime()) out.push({ key: "today", label: `Today ${clockLabel("17:00", hour12)}`, at: evening });
  out.push({ key: "tomorrow", label: `Tomorrow ${clockLabel(defaultTime, hour12)}`, at: instantAt(shiftDay(today, 1), defaultTime, timeZone) });
  const daysToMonday = ((8 - weekdayOfDay(today)) % 7) || 7;
  out.push({ key: "next-week", label: "Next week", at: instantAt(shiftDay(today, daysToMonday), defaultTime, timeZone) });
  return out;
}

/** The default follow-up for a new lead: tomorrow at the default time in the person's zone. */
export function defaultFollowUp(now: Date, timeZone: string | null | undefined, defaultTime = DEFAULT_TIME): Date {
  return instantAt(shiftDay(dayOf(now, timeZone), 1), defaultTime, timeZone);
}

/** A short zone label for display next to the input: "Africa/Nairobi (UTC+3)". */
export function zoneLabel(timeZone: string | null | undefined, at: Date = new Date()): string {
  let name = timeZone ?? "";
  try {
    if (!name) name = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    name = "your time zone";
  }
  const p = partsInZone(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const offset = Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const hh = Math.floor(abs / 60);
  const mm = abs % 60;
  return `${name} (UTC${sign}${hh}${mm ? `:${two(mm)}` : ""})`;
}

/** "Overdue by 2 h": how late something is, in the largest whole unit. Empty when it is not late. */
export function overdueBy(due: Date, now: Date): string {
  const ms = now.getTime() - due.getTime();
  if (ms <= 0) return "";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "Overdue by under a minute";
  if (minutes < 60) return `Overdue by ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `Overdue by ${hours} h`;
  return `Overdue by ${Math.floor(hours / 24)} days`;
}
