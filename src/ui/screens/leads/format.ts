/**
 * How the leads screens write dates, due states and the status and temperature colours. The wording and the colour pairs are the
 * prototype's (`FB.when`, `FB.dueLabel`, `FB.statusTone`, `FB.tempTone`), so the screens read exactly as designed; dates are written
 * in the person's own time zone and clock (B1.08).
 */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface FormatOptions {
  timeZone?: string | null;
  hour12?: boolean;
  now?: Date;
}

export type DueState = "none" | "overdue" | "today" | "upcoming" | "done";

interface Parts {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
}

function partsOf(date: Date, timeZone: string | null | undefined): Parts {
  try {
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: timeZone ?? undefined, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
    const o: Record<string, number> = {};
    for (const p of f.formatToParts(date)) if (p.type !== "literal") o[p.type] = Number(p.value);
    return { y: o.year!, m: o.month!, d: o.day!, h: o.hour! % 24, min: o.minute! };
  } catch {
    return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate(), h: date.getHours(), min: date.getMinutes() };
  }
}

const dayKey = (p: Parts) => p.y * 10000 + p.m * 100 + p.d;

export function makeFormat(opts: FormatOptions = {}) {
  const tz = opts.timeZone ?? null;
  const hour12 = opts.hour12 ?? true;
  const now = opts.now ?? new Date();
  const toDate = (v: string | Date | null | undefined): Date | null => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const nowParts = partsOf(now, tz);

  function shiftDay(days: number): number {
    const base = new Date(Date.UTC(nowParts.y, nowParts.m - 1, nowParts.d + days));
    return base.getUTCFullYear() * 10000 + (base.getUTCMonth() + 1) * 100 + base.getUTCDate();
  }

  const time = (v: string | Date | null | undefined): string => {
    const d = toDate(v);
    if (!d) return "";
    const p = partsOf(d, tz);
    if (!hour12) return `${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
    const h = p.h % 12 || 12;
    return `${h}:${String(p.min).padStart(2, "0")} ${p.h >= 12 ? "PM" : "AM"}`;
  };
  const dshort = (v: string | Date | null | undefined): string => {
    const d = toDate(v);
    if (!d) return "—";
    const p = partsOf(d, tz);
    return `${p.d} ${MON[p.m - 1]}`;
  };
  const date = (v: string | Date | null | undefined): string => {
    const d = toDate(v);
    if (!d) return "—";
    const p = partsOf(d, tz);
    return `${p.d} ${MON[p.m - 1]} ${p.y}`;
  };
  const when = (v: string | Date | null | undefined): string => {
    const d = toDate(v);
    if (!d) return "—";
    const k = dayKey(partsOf(d, tz));
    if (k === shiftDay(0)) return `Today, ${time(d)}`;
    if (k === shiftDay(1)) return `Tomorrow, ${time(d)}`;
    if (k === shiftDay(-1)) return `Yesterday, ${time(d)}`;
    return `${dshort(d)}, ${time(d)}`;
  };
  const dueState = (v: string | Date | null | undefined, done?: boolean): DueState => {
    if (done) return "done";
    const d = toDate(v);
    if (!d) return "none";
    if (dayKey(partsOf(d, tz)) === shiftDay(0)) return d < now ? "overdue" : "today";
    return d < now ? "overdue" : "upcoming";
  };
  const dueLabel = (v: string | Date | null | undefined, done?: boolean): string => {
    const s = dueState(v, done);
    if (s === "none") return "No date";
    if (s === "overdue") return `Overdue · ${dshort(v)}, ${time(v)}`;
    if (s === "today") return `Today · ${time(v)}`;
    return when(v);
  };
  /** "Wed, 19 Oct" style lines are not used by leads; this is the small relative time for the activity feed. */
  const ago = (v: string | Date | null | undefined): string => {
    const d = toDate(v);
    if (!d) return "—";
    const s = (now.getTime() - d.getTime()) / 1000;
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    const days = Math.round(s / 86400);
    return days === 1 ? "yesterday" : `${days} days ago`;
  };
  /** The value for a `datetime-local`/`date` input in the person's zone. */
  const isoDate = (v: string | Date | null | undefined): string => {
    const d = toDate(v);
    if (!d) return "";
    const p = partsOf(d, tz);
    return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  };
  return { time, dshort, date, when, dueState, dueLabel, ago, isoDate, toDate, now };
}

export type Formatters = ReturnType<typeof makeFormat>;

export const DUE_COLOUR: Record<DueState, string> = {
  overdue: "var(--red)",
  today: "var(--orange-text)",
  upcoming: "var(--text-2)",
  done: "var(--text-3)",
  none: "var(--text-2)",
};

/** Lead status colour pairs, by the status's key (the names are the organisation's own and can be renamed). */
export function statusTone(key: string | undefined): [string, string] {
  switch (key) {
    case "NEW":
      return ["var(--blue-soft)", "var(--blue)"];
    case "QUALIFIED":
    case "CONVERTED":
      return ["var(--primary-soft)", "var(--primary-text)"];
    case "CONTACTED":
      return ["var(--surface-3)", "var(--text)"];
    case "NEEDS_IDENTIFIED":
      return ["var(--purple-soft)", "var(--purple)"];
    case "LOST":
      return ["var(--red-soft)", "var(--red)"];
    case "UNQUALIFIED":
    case "INACTIVE":
      return ["var(--surface-3)", "var(--text-3)"];
    default:
      return ["var(--surface-3)", "var(--text-2)"];
  }
}

export type Temperature = "HOT" | "WARM" | "COLD";
export const TEMPERATURES: Temperature[] = ["HOT", "WARM", "COLD"];
export const TEMPERATURE_LABEL: Record<Temperature, string> = { HOT: "Hot", WARM: "Warm", COLD: "Cold" };

export function tempTone(t: string | undefined): [string, string] {
  switch (t) {
    case "HOT":
      return ["var(--red-soft)", "var(--red)"];
    case "WARM":
      return ["var(--orange-soft)", "var(--orange-text)"];
    case "COLD":
      return ["var(--blue-soft)", "var(--blue)"];
    default:
      return ["var(--surface-3)", "var(--text-2)"];
  }
}

export function personInitials(name: string | null | undefined): string {
  if (!name) return "–";
  const p = name.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean);
  if (!p.length) return "?";
  return (p.length > 1 ? p[0]![0]! + p[1]![0]! : p[0]!.slice(0, 2)).toUpperCase();
}
