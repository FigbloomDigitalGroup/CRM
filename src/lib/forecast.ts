/**
 * Forecast arithmetic (FIG-1146, B6.14), pure so every number can be tested against the rules `docs/FORECAST.md` states.
 * Money is held in whole cents (see `src/lib/payments.ts`); a probability is a whole percent from 0 to 100.
 */

/** Used for a stage whose organisation has not set a probability yet. A stage not listed here counts for 0%. */
export const DEFAULT_STAGE_PROBABILITY: Record<string, number> = {
  SOLUTION_PRESENTED: 25,
  PROPOSAL_SENT: 50,
  NEGOTIATION: 75,
};

export interface StageLike {
  key: string;
  probability: number | null;
  isWon: boolean;
  isLost: boolean;
}

/** The percent a deal in this stage is weighted by: won 100, lost 0, else the stage's own value, else the default. */
export function stageProbability(stage: StageLike): { percent: number; isSet: boolean } {
  if (stage.isWon) return { percent: 100, isSet: true };
  if (stage.isLost) return { percent: 0, isSet: true };
  if (stage.probability !== null && stage.probability !== undefined) return { percent: clampPercent(stage.probability), isSet: true };
  return { percent: DEFAULT_STAGE_PROBABILITY[stage.key] ?? 0, isSet: false };
}

export function clampPercent(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** A deal's weighted value in cents: its value times the probability, rounded once per deal so buckets add up to the total. */
export function weightedCents(valueCents: number, percent: number): number {
  return Math.round((valueCents * percent) / 100);
}

/** "2026-11" for a date, in UTC (deal close dates are calendar dates). */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthStartOf(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function addMonths(start: Date, n: number): Date {
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + n, 1));
}

/** Parses "YYYY-MM" into the first day of that month, or null when it is not a real month. */
export function parseMonth(value: string): Date | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)) : null;
}

export type TargetState = "no-target" | "achieved" | "on-track" | "short";

export interface TargetProgress {
  state: TargetState;
  targetCents: number;
  wonCents: number;
  /** Weighted value of the open deals expected to close in the month. */
  weightedCents: number;
  /** Won plus weighted. */
  forecastCents: number;
  shortByCents: number;
  /** Won as a percent of the target, whole percent; null with no target. */
  attainmentPercent: number | null;
}

/**
 * Where a person (or the team) stands against a month's target.
 *   achieved : won already reaches the target
 *   on-track : won plus the weighted closes reaches it
 *   short    : it does not; `shortByCents` is the gap
 *   no-target: nothing to measure against (never "short")
 */
export function targetProgress(wonCents: number, weighted: number, targetCents: number): TargetProgress {
  const forecastCents = wonCents + weighted;
  if (!targetCents || targetCents <= 0) {
    return { state: "no-target", targetCents: 0, wonCents, weightedCents: weighted, forecastCents, shortByCents: 0, attainmentPercent: null };
  }
  const state: TargetState = wonCents >= targetCents ? "achieved" : forecastCents >= targetCents ? "on-track" : "short";
  return {
    state,
    targetCents,
    wonCents,
    weightedCents: weighted,
    forecastCents,
    shortByCents: state === "short" ? targetCents - forecastCents : 0,
    attainmentPercent: Math.round((wonCents / targetCents) * 100),
  };
}
