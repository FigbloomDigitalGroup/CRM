import type { TeamRange } from "../../../api/dto/team";
import type { SortState } from "../../components/DataTable";

/** Pure helpers for the Team page (P2-15). Nothing here reads the API; the screen shows the API's numbers as they come. */

export const RANGES: { id: TeamRange; label: string; phrase: string }[] = [
  { id: "today", label: "Today", phrase: "today" },
  { id: "7d", label: "7 days", phrase: "in the last 7 days" },
  { id: "30d", label: "30 days", phrase: "in the last 30 days" },
];

export const rangePhrase = (range: TeamRange) => RANGES.find((r) => r.id === range)?.phrase ?? "";

export const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", INACTIVE: "Suspended", PENDING: "Invited" };
export const STATUS_TONE: Record<string, "success" | "warning" | "neutral"> = { ACTIVE: "success", INACTIVE: "warning", PENDING: "neutral" };

/** The API's `sort` text from the table's sort state (`-field` for descending). Name ascending when nothing is chosen. */
export function sortParam(sort: SortState): string {
  return sort ? `${sort.dir === "desc" ? "-" : ""}${sort.key}` : "name";
}

/** A count, or a dash where the API said the viewer's role may not see it (null is never shown as zero). */
export const shown = (n: number | null | undefined): string => (n === null || n === undefined ? "—" : String(n));

/**
 * Workload balance: each person's share of the longest bar, and whether they look overloaded (well above the team's average) or idle (none
 * while others carry work). A hint to look, never a rule: nothing is reassigned from here.
 */
export function balanceRows(rows: { membershipId: string; name: string; openLeads: number }[]) {
  const max = Math.max(1, ...rows.map((r) => r.openLeads));
  const avg = rows.length ? rows.reduce((n, r) => n + r.openLeads, 0) / rows.length : 0;
  return rows.map((r) => ({
    ...r,
    width: Math.round((r.openLeads / max) * 100),
    flag: avg > 0 && r.openLeads > avg * 1.5 ? ("high" as const) : avg > 0 && r.openLeads === 0 ? ("idle" as const) : null,
  }));
}

/** Trend bars: each day's height as a share of the busiest day. */
export function trendHeights(trend: { start: string; count: number }[]) {
  const max = Math.max(1, ...trend.map((t) => t.count));
  return trend.map((t) => ({ ...t, height: t.count === 0 ? 2 : Math.max(8, Math.round((t.count / max) * 100)) }));
}
