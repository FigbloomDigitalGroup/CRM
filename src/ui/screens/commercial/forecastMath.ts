/**
 * Forecast display helpers (Q4, FIG-1170). The arithmetic itself (probabilities, weighted values, buckets, target progress) is done by the API
 * (`src/lib/forecast.ts`, `GET /api/orgs/{org}/forecast`); the screen only formats what it returns and never recomputes a total.
 */

export type TargetState = "no-target" | "achieved" | "on-track" | "short" | "masked";

export interface Money {
  count: number;
  full: number | null;
  weighted: number | null;
}

export interface ForecastPerson {
  membershipId: string;
  name: string;
  openDeals: number;
  wonDeals: number;
  state: TargetState;
  target: number | null;
  won: number | null;
  weighted: number | null;
  forecast: number | null;
  shortBy: number | null;
  attainmentPercent: number | null;
}

export interface ForecastTeam extends Omit<ForecastPerson, "membershipId" | "name" | "openDeals" | "wonDeals"> {
  targetSource: "team" | "sum-of-people" | "none";
}

/** `GET /forecast` as the API answers it (the contract types it as `unknown`; shape from docs/FORECAST.md). */
export interface ForecastResponse {
  scope: "mine" | "team";
  month: string;
  months: number;
  asOf: string;
  currency: string;
  valueMasked: boolean;
  stages: (Money & { id: string; key: string; name: string; probability: number; probabilitySet: boolean })[];
  pipeline: Money;
  buckets: (Money & { month: string })[];
  earlier: Money;
  later: Money;
  unscheduled: Money;
  won: { count: number; total: number | null };
  people: ForecastPerson[];
  team: ForecastTeam | null;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-11" to "November" (or "NOV" when short). */
export function monthName(key: string, short = false): string {
  const n = Number(key.slice(5, 7));
  const name = MONTH_NAMES[n - 1] ?? key;
  return short ? name.slice(0, 3).toUpperCase() : name;
}

/** The weighted value of one deal from its stage percent, rounded to the cent like the server does. Null when the value is masked. */
export function weightedOf(value: string | number | null | undefined, percent: number): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * percent) / 100 : null;
}

/** How a target row reads: the plain-words note under the progress bar. */
export function targetNote(state: TargetState, shortBy: number | null, short: (n: number) => string): string {
  switch (state) {
    case "no-target":
      return "Ask Management to set a target";
    case "achieved":
      return "Target reached";
    case "on-track":
      return "On track if this month’s deals close";
    case "short":
      return `${short(shortBy ?? 0)} short even if this month’s deals close`;
    default:
      return "You can’t see this person’s figures.";
  }
}
