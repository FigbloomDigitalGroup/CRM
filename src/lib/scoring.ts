/**
 * Lead score and customer health (FIG-1032, B2.03): rules first, every point
 * explained. These functions are pure: the same inputs always give the same
 * score. The weights are the constants below, documented in docs/SCORING.md;
 * an organisation can scale each factor group through its stored weights.
 *
 * A score only informs. Nothing here moves a deal, assigns a lead or sets a
 * discount.
 */

export interface ScoreFactor {
  /** Stable key for the factor, for the UI and tests. */
  key: string;
  /** What the person reads: "Referral", "No contact for 6 days". */
  label: string;
  /** Signed points, after the organisation's weight. */
  points: number;
  /** Which weight group it belongs to. */
  group: string;
  /** The permission needed to see this factor; absent means everyone who sees the score. */
  requires?: string;
}

export type LeadBand = "HIGH" | "MEDIUM" | "LOW";
export type HealthBand = "GOOD" | "WATCH" | "AT_RISK";

export const LEAD_WEIGHT_GROUPS = ["temperature", "source", "responseSpeed", "contact", "qualification", "similarWins", "followUp"] as const;
export const HEALTH_WEIGHT_GROUPS = ["activity", "tasks", "renewals", "deals", "payments"] as const;
export type Weights = Record<string, number>;

export const DEFAULT_LEAD_WEIGHTS: Weights = Object.fromEntries(LEAD_WEIGHT_GROUPS.map((g) => [g, 1]));
export const DEFAULT_HEALTH_WEIGHTS: Weights = Object.fromEntries(HEALTH_WEIGHT_GROUPS.map((g) => [g, 1]));
export const MIN_WEIGHT = 0;
export const MAX_WEIGHT = 3;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Points for the source of the lead; unlisted sources get 0. */
export const SOURCE_POINTS: Record<string, number> = {
  REFERRAL: 12,
  EXISTING_CUSTOMER: 12,
  PHYSICAL_MEETING: 8,
  WEBSITE: 6,
  NETWORKING: 5,
  PHONE: 5,
  WHATSAPP: 5,
  DIRECT_OUTREACH: 4,
  EMAIL: 4,
  LINKEDIN: 4,
  FACEBOOK: 2,
  INSTAGRAM: 2,
  TIKTOK: 1,
  ADVERTISING: 2,
};

function scaled(points: number, weights: Weights, group: string): number {
  return Math.round(points * (weights[group] ?? 1));
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export interface LeadScoreInput {
  now: Date;
  createdAt: Date;
  temperature: "HOT" | "WARM" | "COLD";
  sourceKey: string | null;
  sourceName: string | null;
  /** Earliest activity or communication on the lead (a first touch), if any. */
  firstContactAt: Date | null;
  /** Latest activity or communication on the lead, if any. */
  lastContactAt: Date | null;
  /** Qualification questions that apply to the lead, and how many have an answer. */
  qualificationQuestions: number;
  qualificationAnswered: number;
  /** Won deals for the same service (counts only, never values). */
  similarWins: number;
  nextFollowUpAt: Date | null;
}

export function scoreLead(input: LeadScoreInput, weights: Weights = DEFAULT_LEAD_WEIGHTS): { score: number; band: LeadBand; factors: ScoreFactor[] } {
  const factors: ScoreFactor[] = [{ key: "start", label: "A lead to work", points: 20, group: "base" }];
  const add = (key: string, label: string, raw: number, group: string) => {
    const points = scaled(raw, weights, group);
    if (points !== 0) factors.push({ key, label, points, group });
  };

  // Temperature
  add("temperature", input.temperature === "HOT" ? "Hot lead" : input.temperature === "WARM" ? "Warm lead" : "Cold lead", { HOT: 30, WARM: 15, COLD: 0 }[input.temperature], "temperature");

  // Source quality
  if (input.sourceKey) {
    add("source", input.sourceName ?? input.sourceKey, SOURCE_POINTS[input.sourceKey] ?? 0, "source");
  }

  // How fast we first touched it
  const ageMs = input.now.getTime() - input.createdAt.getTime();
  if (input.firstContactAt) {
    const waitMs = Math.max(0, input.firstContactAt.getTime() - input.createdAt.getTime());
    if (waitMs <= HOUR) add("response_speed", "First contact within an hour", 12, "responseSpeed");
    else if (waitMs <= DAY) add("response_speed", "First contact within a day", 8, "responseSpeed");
    else if (waitMs <= 3 * DAY) add("response_speed", "First contact within three days", 3, "responseSpeed");
    else add("response_speed", "Slow first contact", -5, "responseSpeed");
  } else if (ageMs > 3 * DAY) {
    add("no_contact", `No contact yet, ${plural(Math.floor(ageMs / DAY), "day")} old`, -8, "contact");
  }

  // Gone quiet since the last touch
  if (input.lastContactAt) {
    const quietDays = Math.floor((input.now.getTime() - input.lastContactAt.getTime()) / DAY);
    if (quietDays > 14) add("quiet", `No contact for ${plural(quietDays, "day")}`, -10, "contact");
    else if (quietDays > 6) add("quiet", `No contact for ${plural(quietDays, "day")}`, -6, "contact");
    else add("recent_contact", quietDays <= 0 ? "Contacted today" : `Contacted ${plural(quietDays, "day")} ago`, 6, "contact");
  }

  // Qualification
  if (input.qualificationQuestions > 0) {
    const ratio = input.qualificationAnswered / input.qualificationQuestions;
    const label = `${input.qualificationAnswered} of ${input.qualificationQuestions} qualification answers`;
    if (ratio >= 1) add("qualification", `All qualification answers in (${input.qualificationAnswered})`, 15, "qualification");
    else if (ratio >= 0.5) add("qualification", label, 8, "qualification");
    else if (ratio > 0) add("qualification", label, 2, "qualification");
    else add("qualification", "No qualification answers yet", -3, "qualification");
  }

  // Similar past wins
  if (input.similarWins >= 5) add("similar_wins", `${plural(input.similarWins, "similar deal")} won before`, 10, "similarWins");
  else if (input.similarWins >= 2) add("similar_wins", `${plural(input.similarWins, "similar deal")} won before`, 6, "similarWins");
  else if (input.similarWins === 1) add("similar_wins", "1 similar deal won before", 3, "similarWins");

  // A follow-up that was missed
  if (input.nextFollowUpAt && input.nextFollowUpAt.getTime() < input.now.getTime()) {
    add("follow_up_overdue", "Follow-up is overdue", -5, "followUp");
  }

  return finish(factors, (s) => (s >= 70 ? "HIGH" : s >= 40 ? "MEDIUM" : "LOW"));
}

export interface HealthInput {
  now: Date;
  companyCreatedAt: Date;
  /** Activities and communications in the last 30 days. */
  recentTouches: number;
  /** Open (pending or in progress) tasks on the company that are past due. */
  overdueTasks: number;
  /** Active services whose end date is within 60 days. */
  renewalsDueSoon: number;
  /** Active services whose end date has already passed. */
  lapsedServices: number;
  openDeals: number;
  wonDealsLast12Months: number;
  /**
   * Payment status, only for roles that may see payments (Finance and Management).
   * Null until the payments tracker exists (B3.03) or when there is nothing to say.
   */
  overduePayments: number | null;
}

export function scoreHealth(input: HealthInput, weights: Weights = DEFAULT_HEALTH_WEIGHTS): { score: number; band: HealthBand; factors: ScoreFactor[] } {
  const factors: ScoreFactor[] = [{ key: "start", label: "Customer account", points: 50, group: "base" }];
  const add = (key: string, label: string, raw: number, group: string, requires?: string) => {
    const points = scaled(raw, weights, group);
    if (points !== 0) factors.push({ key, label, points, group, ...(requires ? { requires } : {}) });
  };

  const ageDays = (input.now.getTime() - input.companyCreatedAt.getTime()) / DAY;
  if (input.recentTouches >= 3) add("recent_activity", `${plural(input.recentTouches, "contact")} in the last 30 days`, 15, "activity");
  else if (input.recentTouches >= 1) add("recent_activity", `${plural(input.recentTouches, "contact")} in the last 30 days`, 8, "activity");
  else if (ageDays > 60) add("no_recent_activity", "No contact in the last 30 days", -12, "activity");

  if (input.overdueTasks > 0) add("overdue_tasks", `${plural(input.overdueTasks, "overdue task")}`, -Math.min(12, input.overdueTasks * 4), "tasks");

  if (input.lapsedServices > 0) add("lapsed_services", `${plural(input.lapsedServices, "service")} past the end date`, -10, "renewals");
  if (input.renewalsDueSoon > 0) add("renewals_due", `${plural(input.renewalsDueSoon, "renewal")} due within 60 days`, -6, "renewals");

  if (input.wonDealsLast12Months > 0) add("recent_win", "A deal won in the last year", 8, "deals");
  if (input.openDeals > 0) add("open_deals", `${plural(input.openDeals, "open deal")}`, 5, "deals");

  if (input.overduePayments !== null && input.overduePayments > 0) {
    add("overdue_payments", `${plural(input.overduePayments, "overdue payment")}`, -Math.min(15, input.overduePayments * 5), "payments", "finance.view.payments");
  }

  return finish(factors, (s) => (s >= 70 ? "GOOD" : s >= 40 ? "WATCH" : "AT_RISK"));
}

function finish<B extends string>(factors: ScoreFactor[], band: (score: number) => B) {
  const total = factors.reduce((sum, f) => sum + f.points, 0);
  const score = Math.max(0, Math.min(100, total));
  return { score, band: band(score), factors };
}

/**
 * The score as one viewer may see it: factors that need a permission the viewer
 * lacks are removed and the total and band are recomputed without them, so the
 * numbers always add up to what is shown and the hidden factor is not a hint.
 */
export function scoreForViewer<B extends string>(
  stored: { factors: ScoreFactor[] },
  has: (permission: string) => boolean,
  bandFor: (score: number) => B,
): { score: number; band: B; factors: ScoreFactor[] } {
  const visible = stored.factors.filter((f) => !f.requires || has(f.requires));
  return finish(visible, bandFor);
}

export const leadBandFor = (s: number): LeadBand => (s >= 70 ? "HIGH" : s >= 40 ? "MEDIUM" : "LOW");
export const healthBandFor = (s: number): HealthBand => (s >= 70 ? "GOOD" : s >= 40 ? "WATCH" : "AT_RISK");

/** A weights object from stored JSON, keeping only known groups within bounds. */
export function sanitiseWeights(raw: unknown, groups: readonly string[], defaults: Weights): Weights {
  const out: Weights = { ...defaults };
  if (raw && typeof raw === "object") {
    for (const group of groups) {
      const v = (raw as Record<string, unknown>)[group];
      if (typeof v === "number" && Number.isFinite(v)) out[group] = Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, v));
    }
  }
  return out;
}
