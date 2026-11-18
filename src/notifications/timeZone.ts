/**
 * Time-zone arithmetic for quiet hours and the daily email cap (B1.11), with no
 * dependencies: everything is done with `Intl`, so a person's quiet hours mean
 * their own wall clock, daylight saving included.
 */
export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

/** Minutes the zone is ahead of UTC at this instant. */
export function offsetMinutes(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** The instant at which the wall clock in `timeZone` reads this date and time. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let result = guess - offsetMinutes(new Date(guess), timeZone) * 60000;
  // The offset at the first guess can differ from the offset at the answer around a clock change.
  result = guess - offsetMinutes(new Date(result), timeZone) * 60000;
  return new Date(result);
}

export function startOfLocalDay(date: Date, timeZone: string): Date {
  const p = localParts(date, timeZone);
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, timeZone);
}

export function startOfNextLocalDay(date: Date, timeZone: string): Date {
  const p = localParts(date, timeZone);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return zonedTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, timeZone);
}

export function parseClock(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(":").map(Number);
  return { hour: h!, minute: m! };
}

export interface QuietHours {
  enabled: boolean;
  start: string;
  end: string;
}

/** Minutes after local midnight. */
function minutesOfDay(p: { hour: number; minute: number }): number {
  return p.hour * 60 + p.minute;
}

export function isInQuietHours(now: Date, quiet: QuietHours, timeZone: string): boolean {
  if (!quiet.enabled) return false;
  const nowM = minutesOfDay(localParts(now, timeZone));
  const start = minutesOfDay(parseClock(quiet.start));
  const end = minutesOfDay(parseClock(quiet.end));
  // 20:00 -> 07:00 crosses midnight; 13:00 -> 14:00 does not.
  return start < end ? nowM >= start && nowM < end : nowM >= start || nowM < end;
}

/** The next moment quiet hours end, counted from `now`. Only meaningful while quiet hours are on. */
export function nextQuietEnd(now: Date, quiet: QuietHours, timeZone: string): Date {
  const p = localParts(now, timeZone);
  const end = parseClock(quiet.end);
  const todayEnd = zonedTimeToUtc(p.year, p.month, p.day, end.hour, end.minute, timeZone);
  if (todayEnd.getTime() > now.getTime()) return todayEnd;
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return zonedTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), end.hour, end.minute, timeZone);
}

export function isValidClock(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
