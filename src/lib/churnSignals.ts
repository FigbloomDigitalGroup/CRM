import { createHash } from "node:crypto";
import { renewalStanding, type RenewalSettings, type RenewalState } from "./renewals";

/**
 * Churn hints, the pure part (FIG-1190, B7.08). Facts about a customer in, reasons out. No database, no model, no money: every fact is a
 * date or a count, and every reason says in plain words what was seen. The service (`churnHintService.ts`) gathers the facts, stores the
 * result and shows each viewer only the reasons they may see (`needs`).
 *
 * Rules, each with a weight (a hint needs a total of at least `MIN_SCORE`):
 *   renewal_lapsed      a recurring service is past its renewal date and its grace period                 3
 *   renewal_due_quiet   a service renews within the window and nobody has been in touch for 14 days        2
 *   service_cancelled   a service was cancelled in the last 45 days                                       2
 *   no_contact_60       no activity on the customer for 60 days or more                                   3
 *   no_contact_30       no activity for 30 to 59 days                                                      1
 *   activity_drop       3 or more activities in the 30 days before the last 30, and none in the last 30    2
 *   dormant             the customer's lifecycle state is Dormant                                          2
 * A customer with no activity at all is judged from the day the record was created, so a brand-new customer is never "quiet".
 */

export const MIN_SCORE = 2;
export type HintLevel = "low" | "medium" | "high";

export const SIGNALS = [
  "renewal_lapsed",
  "renewal_due_quiet",
  "service_cancelled",
  "no_contact_60",
  "no_contact_30",
  "activity_drop",
  "dormant",
] as const;
export type SignalKey = (typeof SIGNALS)[number];

export interface ServiceFact {
  startsOn: Date;
  renewsOn: Date;
  cancelledAt: Date | null;
  stateOverride: RenewalState | null;
}

export interface CustomerFacts {
  createdAt: Date;
  /** Latest activity on the company or one of its contacts. */
  lastActivityAt: Date | null;
  activitiesLast30: number;
  activitiesPrior30: number;
  dormant: boolean;
  services: ServiceFact[];
}

export interface Reason {
  signal: SignalKey;
  text: string;
  weight: number;
  /** The permission a viewer needs for this reason to be shown to them (the data it came from). */
  needs: string;
  /** What was counted, never an amount of money. */
  evidence: Record<string, string | number | boolean | null>;
}

const DAY = 24 * 60 * 60_000;
const daysBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / DAY);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const NEEDS = {
  renewal: "company_services.view",
  activity: "activities.view",
  company: "companies.view",
} as const;

export function evaluateCustomer(facts: CustomerFacts, now: Date, renewal: RenewalSettings): Reason[] {
  const reasons: Reason[] = [];
  const quietSince = facts.lastActivityAt ?? facts.createdAt;
  const quietDays = Math.max(0, daysBetween(quietSince, now));

  for (const s of facts.services) {
    const standing = renewalStanding(s, now, renewal);
    if (standing.state === "LAPSED") {
      reasons.push({
        signal: "renewal_lapsed",
        weight: 3,
        needs: NEEDS.renewal,
        text: `A recurring service was due to renew ${plural(Math.abs(standing.daysToRenewal), "day")} ago and has not renewed.`,
        evidence: { daysPastRenewal: Math.abs(standing.daysToRenewal) },
      });
    } else if (standing.state === "DUE_SOON" && quietDays >= 14) {
      reasons.push({
        signal: "renewal_due_quiet",
        weight: 2,
        needs: NEEDS.renewal,
        text:
          standing.daysToRenewal >= 0
            ? `A recurring service renews in ${plural(standing.daysToRenewal, "day")} and nobody has been in touch for ${plural(quietDays, "day")}.`
            : `A recurring service passed its renewal date ${plural(Math.abs(standing.daysToRenewal), "day")} ago, inside its grace period, and nobody has been in touch for ${plural(quietDays, "day")}.`,
        evidence: { daysToRenewal: standing.daysToRenewal, quietDays },
      });
    } else if (standing.state === "CANCELLED" && s.cancelledAt && daysBetween(s.cancelledAt, now) <= 45) {
      reasons.push({
        signal: "service_cancelled",
        weight: 2,
        needs: NEEDS.renewal,
        text: `A recurring service was cancelled ${plural(daysBetween(s.cancelledAt, now), "day")} ago.`,
        evidence: { daysSinceCancelled: daysBetween(s.cancelledAt, now) },
      });
    }
  }

  if (quietDays >= 60) {
    reasons.push({
      signal: "no_contact_60",
      weight: 3,
      needs: NEEDS.activity,
      text: facts.lastActivityAt ? `No calls, emails, meetings or notes for ${plural(quietDays, "day")}.` : `Nothing has been logged since the customer was added ${plural(quietDays, "day")} ago.`,
      evidence: { quietDays },
    });
  } else if (quietDays >= 30) {
    reasons.push({
      signal: "no_contact_30",
      weight: 1,
      needs: NEEDS.activity,
      text: `No calls, emails, meetings or notes for ${plural(quietDays, "day")}.`,
      evidence: { quietDays },
    });
  }

  if (facts.activitiesPrior30 >= 3 && facts.activitiesLast30 === 0) {
    reasons.push({
      signal: "activity_drop",
      weight: 2,
      needs: NEEDS.activity,
      text: `${plural(facts.activitiesPrior30, "activity", "activities")} in the month before last, none in the last 30 days.`,
      evidence: { previous30: facts.activitiesPrior30, last30: facts.activitiesLast30 },
    });
  }

  if (facts.dormant) {
    reasons.push({
      signal: "dormant",
      weight: 2,
      needs: NEEDS.company,
      text: "The customer is marked Dormant.",
      evidence: { dormant: true },
    });
  }

  // One reason per signal kind, the strongest evidence first: three lapsed services say the same thing once.
  const seen = new Set<SignalKey>();
  return reasons.filter((r) => (seen.has(r.signal) ? false : (seen.add(r.signal), true)));
}

export const scoreOf = (reasons: readonly Pick<Reason, "weight">[]) => reasons.reduce((n, r) => n + r.weight, 0);

export function levelFor(score: number): HintLevel | null {
  if (score >= 6) return "high";
  if (score >= 4) return "medium";
  if (score >= MIN_SCORE) return "low";
  return null;
}

/**
 * Identifies the situation by the kinds of trouble seen, not by the numbers (the days counted change every day). A dismissed hint comes
 * back only when a new kind of trouble appears; the numbers in an open hint are kept current by the refresh.
 */
export function signalsHash(reasons: readonly Reason[]): string {
  const stable = [...new Set(reasons.map((r) => r.signal))].sort().join("|");
  return createHash("sha256").update(stable).digest("hex").slice(0, 32);
}

/** The reasons one viewer may see, with the level and sentence computed from those alone. Null when too little is left to be a hint. */
export function viewForViewer(reasons: readonly Reason[], hasPermission: (key: string) => boolean) {
  const visible = reasons.filter((r) => hasPermission(r.needs));
  const score = scoreOf(visible);
  const level = levelFor(score);
  if (!level) return null;
  const strongest = [...visible].sort((a, b) => b.weight - a.weight)[0]!;
  return {
    level,
    score,
    reasons: visible.map(({ signal, text, weight }) => ({ signal, text, weight })),
    summary: `${level === "high" ? "Worth a call this week" : level === "medium" ? "Worth a look" : "Keep an eye on"}: ${strongest.text}`,
  };
}
