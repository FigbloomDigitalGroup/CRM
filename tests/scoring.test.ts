import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { enqueueAndRunNow } from "../src/jobs/runner";
import {
  DEFAULT_HEALTH_WEIGHTS,
  DEFAULT_LEAD_WEIGHTS,
  healthBandFor,
  leadBandFor,
  sanitiseWeights,
  scoreForViewer,
  scoreHealth,
  scoreLead,
  type HealthInput,
  type LeadScoreInput,
} from "../src/lib/scoring";
import * as activityService from "../src/services/activityService";
import * as companyService from "../src/services/companyService";
import * as leadService from "../src/services/leadService";
import {
  getCustomerHealth,
  getLeadScore,
  getScoringWeights,
  recomputeAllScores,
  updateScoringWeights,
} from "../src/services/scoreService";
import { updateQualification } from "../src/services/qualificationService";
import { createTestContext, createTestOrganization, getLeadStatusId } from "./helpers/fixtures";

const NOW = new Date("2026-10-23T09:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const H = 3_600_000;
const D = 24 * H;

function lead(over: Partial<LeadScoreInput> = {}): LeadScoreInput {
  return {
    now: NOW,
    createdAt: ago(2 * H),
    temperature: "WARM",
    sourceKey: null,
    sourceName: null,
    firstContactAt: null,
    lastContactAt: null,
    qualificationQuestions: 0,
    qualificationAnswered: 0,
    similarWins: 0,
    nextFollowUpAt: null,
    ...over,
  };
}

function health(over: Partial<HealthInput> = {}): HealthInput {
  return {
    now: NOW,
    companyCreatedAt: ago(200 * D),
    recentTouches: 0,
    overdueTasks: 0,
    renewalsDueSoon: 0,
    lapsedServices: 0,
    openDeals: 0,
    wonDealsLast12Months: 0,
    overduePayments: null,
    ...over,
  };
}

describe("lead score rules (FIG-1032)", () => {
  it("scores a hot, referred, quickly contacted, fully qualified lead high, with the reasons", () => {
    const r = scoreLead(
      lead({ temperature: "HOT", sourceKey: "REFERRAL", sourceName: "Referral", createdAt: ago(2 * D), firstContactAt: ago(2 * D - 20 * 60_000), lastContactAt: ago(D), qualificationQuestions: 4, qualificationAnswered: 4, similarWins: 6 }),
    );
    expect(r.band).toBe("HIGH");
    expect(r.factors.map((f) => [f.key, f.points])).toEqual([
      ["start", 20],
      ["temperature", 30],
      ["source", 12],
      ["response_speed", 12],
      ["recent_contact", 6],
      ["qualification", 15],
      ["similar_wins", 10],
    ]);
    expect(r.factors.find((f) => f.key === "source")!.label).toBe("Referral");
    // Clamped at 100 even when the factors add up to more.
    expect(r.score).toBe(100);
  });

  it("scores warm and cold leads, and a neglected one low, with the reasons visible", () => {
    const warm = scoreLead(lead({ temperature: "WARM", sourceKey: "WEBSITE", sourceName: "Website" }));
    expect(warm).toMatchObject({ score: 41, band: "MEDIUM" });

    const cold = scoreLead(lead({ temperature: "COLD", createdAt: ago(10 * D) }));
    expect(cold.band).toBe("LOW");
    expect(cold.factors.map((f) => f.label)).toContain("No contact yet, 10 days old");

    const quiet = scoreLead(lead({ createdAt: ago(20 * D), firstContactAt: ago(19 * D), lastContactAt: ago(8 * D), nextFollowUpAt: ago(D) }));
    expect(quiet.factors.map((f) => f.label)).toEqual(expect.arrayContaining(["No contact for 8 days", "Follow-up is overdue"]));
  });

  it("every score has at least one factor, even when nothing else applies, and is deterministic", () => {
    const a = scoreLead(lead({ temperature: "COLD" }));
    expect(a.factors.length).toBeGreaterThanOrEqual(1);
    expect(scoreLead(lead({ temperature: "COLD" }))).toEqual(a);
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(scoreLead(lead({ createdAt: ago(40 * D), temperature: "COLD", lastContactAt: ago(30 * D), nextFollowUpAt: ago(D), qualificationQuestions: 3 })).score).toBeGreaterThanOrEqual(0);
  });

  it("covers every response-speed and qualification step", () => {
    const base = { createdAt: ago(10 * D) };
    const speed = (waitMs: number) => scoreLead(lead({ ...base, firstContactAt: new Date(base.createdAt.getTime() + waitMs), lastContactAt: ago(D) })).factors.find((f) => f.key === "response_speed")!.points;
    expect([speed(30 * 60_000), speed(5 * H), speed(2 * D), speed(5 * D)]).toEqual([12, 8, 3, -5]);
    const qual = (answered: number) => scoreLead(lead({ qualificationQuestions: 4, qualificationAnswered: answered })).factors.find((f) => f.key === "qualification")!.points;
    expect([qual(4), qual(2), qual(1), qual(0)]).toEqual([15, 8, 2, -3]);
    const wins = (n: number) => scoreLead(lead({ similarWins: n })).factors.find((f) => f.key === "similar_wins")?.points ?? 0;
    expect([wins(0), wins(1), wins(2), wins(5)]).toEqual([0, 3, 6, 10]);
  });

  it("an organisation's weights scale a group, and a weight of 0 removes it", () => {
    const input = lead({ temperature: "HOT", sourceKey: "REFERRAL", sourceName: "Referral" });
    expect(scoreLead(input).score).toBe(62);
    expect(scoreLead(input, { ...DEFAULT_LEAD_WEIGHTS, temperature: 0.5 }).factors.find((f) => f.key === "temperature")!.points).toBe(15);
    const off = scoreLead(input, { ...DEFAULT_LEAD_WEIGHTS, temperature: 0 });
    expect(off.factors.some((f) => f.key === "temperature")).toBe(false);
    expect(off.factors.some((f) => f.key === "start")).toBe(true);
    expect(sanitiseWeights({ temperature: 9, source: -2, bogus: 1, followUp: "x" }, Object.keys(DEFAULT_LEAD_WEIGHTS), DEFAULT_LEAD_WEIGHTS)).toMatchObject({ temperature: 3, source: 0, followUp: 1 });
  });

  it("bands", () => {
    expect([leadBandFor(70), leadBandFor(69), leadBandFor(40), leadBandFor(39)]).toEqual(["HIGH", "MEDIUM", "MEDIUM", "LOW"]);
    expect([healthBandFor(70), healthBandFor(50), healthBandFor(39)]).toEqual(["GOOD", "WATCH", "AT_RISK"]);
  });
});

describe("customer health rules (FIG-1032)", () => {
  it("rewards recent contact and wins, penalises overdue work, lapsed services and silence", () => {
    const good = scoreHealth(health({ recentTouches: 4, wonDealsLast12Months: 1, openDeals: 2 }));
    expect(good.band).toBe("GOOD");
    expect(good.factors.map((f) => f.label)).toEqual(["Customer account", "4 contacts in the last 30 days", "A deal won in the last year", "2 open deals"]);

    const bad = scoreHealth(health({ overdueTasks: 5, lapsedServices: 1, renewalsDueSoon: 2 }));
    expect(bad.band).toBe("AT_RISK");
    expect(bad.factors.find((f) => f.key === "overdue_tasks")!.points).toBe(-12); // capped
    expect(bad.factors.map((f) => f.key)).toEqual(expect.arrayContaining(["no_recent_activity", "lapsed_services", "renewals_due"]));

    // A brand-new account is not blamed for silence.
    expect(scoreHealth(health({ companyCreatedAt: ago(5 * D) })).factors.map((f) => f.key)).toEqual(["start"]);
  });

  it("the payments factor is visible only with finance.view.payments, and the total and band are recomputed without it", () => {
    const r = scoreHealth(health({ recentTouches: 2, overduePayments: 3 }));
    const payment = r.factors.find((f) => f.key === "overdue_payments")!;
    expect(payment).toMatchObject({ points: -15, requires: "finance.view.payments" });

    const asFinance = scoreForViewer(r, () => true, healthBandFor);
    expect(asFinance.score).toBe(r.score);
    const asSales = scoreForViewer(r, () => false, healthBandFor);
    expect(asSales.factors.some((f) => f.key === "overdue_payments")).toBe(false);
    expect(asSales.score).toBe(r.score + 15);
    expect(asSales.factors.reduce((n, f) => n + f.points, 0)).toBe(asSales.score);
    expect(DEFAULT_HEALTH_WEIGHTS.payments).toBe(1);
  });
});

describe("scores on records (FIG-1032)", () => {
  async function setup() {
    const org = await createTestOrganization("Score");
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES", "owner");
    const other = await createTestContext(org.id, "SALES", "other");
    const finance = await createTestContext(org.id, "FINANCE");
    const statusId = await getLeadStatusId(org.id);
    return { org, management, sales, other, finance, statusId };
  }

  it("a new lead is scored on creation, the score explains itself, and logging contact and qualification answers raises it", async () => {
    const { org, sales, statusId } = await setup();
    const referral = await adminDb.leadSource.findFirstOrThrow({ where: { organizationId: org.id, key: "REFERRAL" } });
    const service = await adminDb.service.findFirstOrThrow({ where: { organizationId: org.id, key: "CCTV" } });
    const { lead: created } = await leadService.createLead(sales, { leadStatusId: statusId, temperature: "HOT", leadSourceId: referral.id, serviceInterestId: service.id });

    const stored = await adminDb.lead.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.scoreValue).not.toBeNull();
    const first = await getLeadScore(sales, created.id);
    expect(first.factors.map((f) => f.label)).toEqual(expect.arrayContaining(["Hot lead", "Referral"]));
    expect(first.factors.reduce((n, f) => n + f.points, 0)).toBe(first.score);

    await activityService.createActivity(sales, { type: "CALL", subject: "Intro call", leadId: created.id });
    await updateQualification(sales, created.id, { cctv_cameras: 6, budget_range: "100k_to_500k", decision_maker: "Ms Achieng", timeline: "this_month", cctv_site_type: "office", cctv_site_visit: true });
    const second = await getLeadScore(sales, created.id);
    expect(second.score).toBeGreaterThan(first.score);
    expect(second.factors.map((f) => f.key)).toEqual(expect.arrayContaining(["response_speed", "recent_contact", "qualification"]));
  });

  it("a score is only readable by someone who can open the lead; the list row carries it", async () => {
    const { sales, other, management, statusId } = await setup();
    const { lead: mine } = await leadService.createLead(sales, { leadStatusId: statusId });
    await expect(getLeadScore(other, mine.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getLeadScore(management, mine.id)).score).toBeGreaterThan(0);
    const rows = await leadService.listLeads(sales, {});
    expect(rows.find((r) => r.id === mine.id)!.scoreValue).not.toBeNull();
  });

  it("customer health reflects activity, and is computed on first ask", async () => {
    const { org, management } = await setup();
    const { company } = await companyService.createCompany(management, { name: "Healthy Co" });
    await adminDb.company.update({ where: { id: company.id }, data: { createdAt: new Date(Date.now() - 200 * D) } });
    const quiet = await getCustomerHealth(management, company.id);
    expect(quiet.factors.map((f) => f.key)).toContain("no_recent_activity");

    await activityService.createActivity(management, { type: "MEETING", subject: "Review", companyId: company.id });
    const after = await getCustomerHealth(management, company.id);
    expect(after.score).toBeGreaterThan(quiet.score);
    expect(after.factors.map((f) => f.key)).toContain("recent_activity");
    void org;
  });

  it("the nightly recompute and its job refresh every open lead and company", async () => {
    const { org, management, statusId } = await setup();
    const { lead: a } = await leadService.createLead(management, { leadStatusId: statusId });
    const { company } = await companyService.createCompany(management, { name: "Nightly Co" });
    await adminDb.lead.update({ where: { id: a.id }, data: { scoreValue: null, scoreFactors: undefined, scoredAt: null } });
    await adminDb.company.update({ where: { id: company.id }, data: { healthValue: null, healthScoredAt: null } });

    const run = await enqueueAndRunNow({ organizationId: org.id, type: "scores.recompute" });
    expect(run.outcome).toBe("succeeded");
    expect((await adminDb.lead.findUniqueOrThrow({ where: { id: a.id } })).scoreValue).not.toBeNull();
    expect((await adminDb.company.findUniqueOrThrow({ where: { id: company.id } })).healthValue).not.toBeNull();
    const totals = await recomputeAllScores(org.id);
    expect(totals.leads).toBeGreaterThanOrEqual(1);
    expect(totals.companies).toBeGreaterThanOrEqual(1);
  });

  it("Management scales the weights; others cannot; bad weights are refused; scores pick the change up on recompute", async () => {
    const { org, management, sales, statusId } = await setup();
    const { lead: hot } = await leadService.createLead(management, { leadStatusId: statusId, temperature: "HOT" });
    const before = (await getLeadScore(management, hot.id)).factors.find((f) => f.key === "temperature")!.points;
    expect(before).toBe(30);

    await expect(updateScoringWeights(sales, { lead: { temperature: 0 } })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getScoringWeights(sales)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateScoringWeights(management, { lead: { temperature: 9, nope: 1 } })).rejects.toBeInstanceOf(ValidationError);

    const saved = await updateScoringWeights(management, { lead: { temperature: 0.5 } });
    expect(saved.lead.temperature).toBe(0.5);
    await recomputeAllScores(org.id);
    expect((await getLeadScore(management, hot.id)).factors.find((f) => f.key === "temperature")!.points).toBe(15);
    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: "scoring.weights_changed" } });
    expect(audit).toHaveLength(1);
  });

  it("another organisation's weights and scores are separate", async () => {
    const one = await setup();
    const two = await setup();
    await updateScoringWeights(one.management, { lead: { temperature: 2 } });
    expect((await getScoringWeights(two.management)).lead.temperature).toBe(1);
    const { lead: l } = await leadService.createLead(one.management, { leadStatusId: one.statusId });
    await expect(getLeadScore(two.management, l.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
