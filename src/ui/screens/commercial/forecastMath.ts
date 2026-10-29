import { STAGE_PROBABILITY, type DemoDeal } from "./demo/data";

/** Forecast arithmetic (Q4, FIG-1170), pure so the numbers can be tested against the rules the screen explains. */

export const probabilityOf = (d: DemoDeal): number => d.prob ?? STAGE_PROBABILITY[d.stage] ?? 0;
export const weightedValue = (d: DemoDeal): number => d.value * probabilityOf(d);

export const isOpen = (d: DemoDeal) => d.stage !== "Closed Won" && d.stage in STAGE_PROBABILITY;

export interface MonthBucket {
  label: string;
  full: number;
  weighted: number;
}

/** Expected closes by calendar month, in the order given (`[monthIndex, label]`), weighted by stage probability. */
export function monthBuckets(open: readonly DemoDeal[], months: readonly (readonly [number, string])[]): MonthBucket[] {
  return months.map(([m, label]) => {
    const ds = open.filter((d) => new Date(d.close).getMonth() === m);
    return { label, full: ds.reduce((a, d) => a + d.value, 0), weighted: ds.reduce((a, d) => a + weightedValue(d), 0) };
  });
}

export type TargetState = "no-target" | "on-track" | "short";

export interface TargetProgress {
  state: TargetState;
  won: number;
  forecast: number;
  target: number;
  shortBy: number;
}

/** Whether won plus this month's weighted closes reaches the target. A person with no target is never "short". */
export function targetProgress(won: number, forecast: number, target: number): TargetProgress {
  if (!target) return { state: "no-target", won, forecast, target: 0, shortBy: 0 };
  const reached = won + forecast >= target;
  return { state: reached ? "on-track" : "short", won, forecast, target, shortBy: reached ? 0 : target - won - forecast };
}
