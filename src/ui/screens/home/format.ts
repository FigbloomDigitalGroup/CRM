/** Small, pure helpers the home, search and notification screens share. */

export function ago(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const diff = Math.max(0, now - Date.parse(iso));
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** "Today, 3:00 PM", "Tomorrow", "2 days overdue": the due wording the design uses, in the person's own time zone. */
export function dueLabel(iso: string | null | undefined, opts: { now?: number; timeZone?: string | null; hour12?: boolean } = {}): { text: string; state: "overdue" | "today" | "later" | "none" } {
  if (!iso) return { text: "No due date", state: "none" };
  const now = opts.now ?? Date.now();
  const tz = opts.timeZone ?? undefined;
  const day = (t: number) => new Date(t).toLocaleDateString("en-CA", { timeZone: tz });
  const due = Date.parse(iso);
  const dayDiff = Math.round((Date.parse(day(due)) - Date.parse(day(now))) / 86_400_000);
  const time = new Date(due).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: opts.hour12 ?? true, timeZone: tz });
  if (dayDiff < 0) return { text: dayDiff === -1 ? "Overdue · yesterday" : `Overdue · ${-dayDiff} days`, state: "overdue" };
  if (dayDiff === 0) return { text: due < now ? `Overdue · today ${time}` : `Today ${time}`, state: due < now ? "overdue" : "today" };
  if (dayDiff === 1) return { text: `Tomorrow ${time}`, state: "later" };
  return { text: new Date(due).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz }), state: "later" };
}

/** Whole-number money without a currency we do not know here: the API formats nothing, the organisation's currency comes from the record. */
export function money(value: number | string | null | undefined, currency = "KES"): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${currency} ${Math.round(n).toLocaleString("en-US")}`;
}

export function moneyShort(value: number | string | null | undefined, currency = "KES"): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${currency} ${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${currency} ${Math.round(n / 1_000)}K`;
  return `${currency} ${Math.round(n)}`;
}

export function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : "—";
}

export function titleCase(key: string): string {
  const s = key.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
