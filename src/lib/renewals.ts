import { daysUntil, startOfDay } from "./payments";

/**
 * Renewal rules for recurring services (FIG-1051, B3.05). Pure: callers pass `today`, so every rule can be tested with a
 * fixed clock. The state is derived from the dates; a person's override (always with a reason) wins over the rule.
 */
export type RenewalState = "ACTIVE" | "DUE_SOON" | "LAPSED" | "STARTS_LATER" | "CANCELLED";
export type BillingCycle = "MONTHLY" | "QUARTERLY" | "YEARLY";

export const RENEWAL_STATES: readonly RenewalState[] = ["ACTIVE", "DUE_SOON", "LAPSED", "STARTS_LATER", "CANCELLED"];
export const BILLING_CYCLES: readonly BillingCycle[] = ["MONTHLY", "QUARTERLY", "YEARLY"];

export interface RenewalSettings {
  /** A service is "due" from this many days before its renewal date. */
  dueSoonDays: number;
  /** It lapses once the renewal date is this many days past. */
  graceDays: number;
}

export const DEFAULT_RENEWAL_SETTINGS: RenewalSettings = { dueSoonDays: 30, graceDays: 14 };
export const MAX_DUE_SOON_DAYS = 365;
export const MAX_GRACE_DAYS = 180;

export interface RenewalFacts {
  startsOn: Date;
  renewsOn: Date;
  cancelledAt: Date | null;
  stateOverride: RenewalState | null;
}

export interface RenewalStanding {
  state: RenewalState;
  /** `rule` when derived from the dates, `override` when a person set it. */
  source: "rule" | "override";
  /** Days from today to the renewal date; negative once it has passed. */
  daysToRenewal: number;
}

/**
 * Cancelled wins, then a person's override, then the dates:
 *   starts in the future          -> STARTS_LATER
 *   renewal date past + grace     -> LAPSED
 *   renewal within the due window (or past, still inside grace) -> DUE_SOON
 *   otherwise                     -> ACTIVE
 */
export function renewalStanding(facts: RenewalFacts, today: Date, settings: RenewalSettings = DEFAULT_RENEWAL_SETTINGS): RenewalStanding {
  const daysToRenewal = daysUntil(facts.renewsOn, today);
  if (facts.cancelledAt) return { state: "CANCELLED", source: "rule", daysToRenewal };
  if (facts.stateOverride) return { state: facts.stateOverride, source: "override", daysToRenewal };
  if (startOfDay(facts.startsOn).getTime() > startOfDay(today).getTime()) return { state: "STARTS_LATER", source: "rule", daysToRenewal };
  if (daysToRenewal < -settings.graceDays) return { state: "LAPSED", source: "rule", daysToRenewal };
  if (daysToRenewal <= settings.dueSoonDays) return { state: "DUE_SOON", source: "rule", daysToRenewal };
  return { state: "ACTIVE", source: "rule", daysToRenewal };
}

/** Whether a standing means the customer needs attention about this service (it is due or has lapsed). */
export const needsRenewalAttention = (state: RenewalState) => state === "DUE_SOON" || state === "LAPSED";

const MONTHS: Record<BillingCycle, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };

/** Adds months keeping the day of the month where it exists (31 Jan + 1 month is 28 or 29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(date.getUTCDate(), lastDay)));
}

/** The date of the period after `renewsOn`. */
export function nextRenewalDate(renewsOn: Date, cycle: BillingCycle): Date {
  return addMonths(startOfDay(renewsOn), MONTHS[cycle]);
}

/**
 * The renewal date after a renewal that happens on `today`: one period on from the old date, and if a late renewal
 * would still leave the date in the past, further periods until it is ahead of today.
 */
export function renewedUntil(renewsOn: Date, cycle: BillingCycle, today: Date): Date {
  let next = nextRenewalDate(renewsOn, cycle);
  let guard = 0;
  while (next.getTime() <= startOfDay(today).getTime() && guard++ < 600) next = nextRenewalDate(next, cycle);
  return next;
}
