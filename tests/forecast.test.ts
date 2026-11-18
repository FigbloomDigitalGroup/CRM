import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import { addMonths, monthKey, parseMonth, stageProbability, targetProgress, weightedCents } from "../src/lib/forecast";
import { getForecast, listMonthTargets, setTarget } from "../src/services/forecastService";
import { getReport } from "../src/services/reportsV2Service";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

/** FIG-1146 (B6.14): forecast and targets. Calculation tests with fixtures, masking by role, tenant isolation. */

const NOW = new Date("2026-11-10T09:00:00Z");

// A V1.1 feature: its permissions and routes exist only once the release is raised (src/lib/featureFlags.ts).
const ORIGINAL_RELEASE = process.env.ACTIVE_RELEASE;
beforeAll(() => {
  process.env.ACTIVE_RELEASE = "v1.1";
});
afterAll(() => {
  if (ORIGINAL_RELEASE === undefined) delete process.env.ACTIVE_RELEASE;
  else process.env.ACTIVE_RELEASE = ORIGINAL_RELEASE;
});

describe("forecast arithmetic (pure)", () => {
  it("weights by stage probability, with the documented defaults and overrides", () => {
    expect(stageProbability({ key: "PROPOSAL_SENT", probability: null, isWon: false, isLost: false })).toEqual({ percent: 50, isSet: false });
    expect(stageProbability({ key: "PROPOSAL_SENT", probability: 60, isWon: false, isLost: false })).toEqual({ percent: 60, isSet: true });
    expect(stageProbability({ key: "CUSTOM", probability: null, isWon: false, isLost: false })).toEqual({ percent: 0, isSet: false });
    expect(stageProbability({ key: "CLOSED_WON", probability: null, isWon: true, isLost: false }).percent).toBe(100);
    expect(stageProbability({ key: "CLOSED_LOST", probability: 40, isWon: false, isLost: true }).percent).toBe(0);
    expect(stageProbability({ key: "X", probability: 250, isWon: false, isLost: false }).percent).toBe(100);
    expect(weightedCents(33333, 50)).toBe(16667);
  });

  it("states where a target stands", () => {
    expect(targetProgress(10, 5, 0).state).toBe("no-target");
    expect(targetProgress(100, 0, 100).state).toBe("achieved");
    expect(targetProgress(60, 40, 100)).toMatchObject({ state: "on-track", shortByCents: 0, forecastCents: 100 });
    expect(targetProgress(60, 30, 100)).toMatchObject({ state: "short", shortByCents: 10, attainmentPercent: 60 });
  });

  it("handles months", () => {
    expect(parseMonth("2026-13")).toBeNull();
    expect(parseMonth("2026-11")?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(monthKey(addMonths(parseMonth("2026-11")!, 2))).toBe("2027-01");
  });
});

async function world() {
  const org = await createTestOrganization("Forecast Org");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const salesA = await createTestContext(org.id, "SALES");
  const salesB = await createTestContext(org.id, "SALES");
  const salesC = await createTestContext(org.id, "SALES");
  const finance = await createTestContext(org.id, "FINANCE");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const company = await adminDb.company.create({ data: { organizationId: org.id, name: "Fixture Co" } });
  const stages = await adminDb.pipelineStage.findMany({ where: { organizationId: org.id } });
  const stage = (key: string) => stages.find((s) => s.key === key)!.id;
  const deal = (owner: { membershipId: string }, stageKey: string, value: number | null, close: string | null, won?: string) =>
    adminDb.deal.create({
      data: {
        organizationId: org.id,
        companyId: company.id,
        ownerMembershipId: owner.membershipId,
        pipelineStageId: stage(stageKey),
        value: value === null ? null : value.toFixed(2),
        expectedCloseDate: close ? new Date(close) : null,
        outcome: won ? "WON" : "OPEN",
        wonAt: won ? new Date(won) : null,
      },
    });
  // Sales A: open 700,000, weighted 425,000.
  await deal(salesA, "SOLUTION_PRESENTED", 100000, "2026-11-20");
  await deal(salesA, "PROPOSAL_SENT", 200000, "2026-11-25");
  await deal(salesA, "NEGOTIATION", 400000, "2026-12-05");
  // Sales B: open 1,140,000 (one in the month, one earlier, one later, one with no date), weighted 810,000.
  await deal(salesB, "NEGOTIATION", 1000000, "2026-11-30");
  await deal(salesB, "SOLUTION_PRESENTED", 50000, null);
  await deal(salesB, "PROPOSAL_SENT", 80000, "2026-10-15");
  await deal(salesB, "NEGOTIATION", 10000, "2027-06-01");
  // Won: A this month, B last month (not counted), C this month.
  await deal(salesA, "CLOSED_WON", 500000, "2026-11-03", "2026-11-03T08:00:00Z");
  await deal(salesB, "CLOSED_WON", 300000, "2026-10-31", "2026-10-31T08:00:00Z");
  await deal(salesC, "CLOSED_WON", 600000, "2026-11-04", "2026-11-04T08:00:00Z");
  await setTarget(management, { month: "2026-11", membershipId: salesA.membershipId, amount: 600000 });
  await setTarget(management, { month: "2026-11", membershipId: salesB.membershipId, amount: 1000000 });
  await setTarget(management, { month: "2026-11", membershipId: salesC.membershipId, amount: 500000 });
  return { org, management, salesA, salesB, salesC, finance, delivery };
}

describe("forecast (FIG-1146)", () => {
  it("weights the pipeline by period and buckets every open deal exactly once", async () => {
    const w = await world();
    const f = await getForecast(w.management, { scope: "team", month: "2026-11", months: 3, now: NOW });
    expect(f.valueMasked).toBe(false);
    expect(f.pipeline).toEqual({ count: 7, full: "1840000.00", weighted: "1235000.00" });
    expect(f.buckets).toEqual([
      { month: "2026-11", count: 3, full: "1300000.00", weighted: "875000.00" },
      { month: "2026-12", count: 1, full: "400000.00", weighted: "300000.00" },
      { month: "2027-01", count: 0, full: "0.00", weighted: "0.00" },
    ]);
    expect(f.earlier).toEqual({ count: 1, full: "80000.00", weighted: "40000.00" });
    expect(f.later).toEqual({ count: 1, full: "10000.00", weighted: "7500.00" });
    expect(f.unscheduled).toEqual({ count: 1, full: "50000.00", weighted: "12500.00" });
    const parts = [...f.buckets, f.earlier, f.later, f.unscheduled];
    expect(parts.reduce((n, p) => n + p.count, 0)).toBe(f.pipeline.count);
    expect(parts.reduce((n, p) => n + Number(p.weighted), 0)).toBe(Number(f.pipeline.weighted));
    expect(f.stages.map((s) => [s.key, s.probability, s.probabilitySet])).toEqual([
      ["SOLUTION_PRESENTED", 25, false],
      ["PROPOSAL_SENT", 50, false],
      ["NEGOTIATION", 75, false],
    ]);
  });

  it("reconciles with the pipeline report and with won deals", async () => {
    const w = await world();
    const f = await getForecast(w.management, { scope: "team", month: "2026-11", now: NOW });
    const report = await getReport(w.management, "PIPELINE_BY_STAGE");
    expect(report.table.totals).toMatchObject({ deals: f.pipeline.count, value: f.pipeline.full });
    expect(f.stages.map((s) => s.full).reduce((n, v) => n + Number(v), 0)).toBe(Number(f.pipeline.full));
    expect(f.won).toEqual({ count: 2, total: "1100000.00" });
    const won = await adminDb.deal.aggregate({ where: { organizationId: w.org.id, outcome: "WON", wonAt: { gte: new Date("2026-11-01"), lt: new Date("2026-12-01") } }, _sum: { value: true } });
    expect(Number(won._sum.value)).toBe(1100000);
  });

  it("calculates on-track state per person and for the team", async () => {
    const w = await world();
    const f = await getForecast(w.management, { scope: "team", month: "2026-11", now: NOW });
    const by = new Map(f.people.map((p) => [p.membershipId, p]));
    expect(by.get(w.salesA.membershipId)).toMatchObject({ state: "on-track", won: "500000.00", weighted: "125000.00", forecast: "625000.00", target: "600000.00", shortBy: "0.00", attainmentPercent: 83 });
    expect(by.get(w.salesB.membershipId)).toMatchObject({ state: "short", won: "0.00", weighted: "750000.00", shortBy: "250000.00" });
    expect(by.get(w.salesC.membershipId)).toMatchObject({ state: "achieved", won: "600000.00", attainmentPercent: 120 });
    expect(f.team).toMatchObject({ targetSource: "sum-of-people", target: "2100000.00", won: "1100000.00", weighted: "875000.00", state: "short", shortBy: "125000.00" });
    await setTarget(w.management, { month: "2026-11", membershipId: null, amount: 3000000 });
    const g = await getForecast(w.management, { scope: "team", month: "2026-11", now: NOW });
    expect(g.team).toMatchObject({ targetSource: "team", target: "3000000.00", state: "short", shortBy: "1025000.00" });
    await setTarget(w.management, { month: "2026-11", membershipId: null, amount: null });
    expect((await getForecast(w.management, { scope: "team", month: "2026-11", now: NOW })).team?.targetSource).toBe("sum-of-people");
  });

  it("uses an organisation's own stage probability when it is set", async () => {
    const w = await world();
    await adminDb.pipelineStage.updateMany({ where: { organizationId: w.org.id, key: "NEGOTIATION" }, data: { probability: 90 } });
    const f = await getForecast(w.management, { scope: "mine", month: "2026-11", now: NOW });
    // Management owns no deals: a clean zero.
    expect(f.pipeline).toEqual({ count: 0, full: "0.00", weighted: "0.00" });
    const team = await getForecast(w.management, { scope: "team", month: "2026-11", now: NOW });
    expect(team.stages.find((s) => s.key === "NEGOTIATION")).toMatchObject({ probability: 90, probabilitySet: true });
    // Three Negotiation deals (400,000, 1,000,000, 10,000) gain 15 points each: 1,235,000 + 211,500.
    expect(team.pipeline.weighted).toBe("1446500.00");
  });
});

describe("forecast masking and access", () => {
  it("Sales sees values only for their own deals and cannot ask for the team", async () => {
    const w = await world();
    const mine = await getForecast(w.salesA, { month: "2026-11", now: NOW });
    expect(mine.scope).toBe("mine");
    expect(mine.valueMasked).toBe(false);
    expect(mine.pipeline).toEqual({ count: 3, full: "700000.00", weighted: "425000.00" });
    expect(mine.people.map((p) => p.membershipId)).toEqual([w.salesA.membershipId]);
    expect(mine.team).toBeNull();
    expect(JSON.stringify(mine)).not.toContain("1000000.00");
    expect(JSON.stringify(mine)).not.toContain(w.salesB.membershipId);
    await expect(getForecast(w.salesA, { scope: "team", now: NOW })).rejects.toBeInstanceOf(ForbiddenError);
    // A person's own target only.
    const t = await listMonthTargets(w.salesA, "2026-11");
    expect(t.items.map((i) => [i.membershipId, i.amount])).toEqual([[w.salesA.membershipId, "600000.00"]]);
    expect((await listMonthTargets(w.management, "2026-11")).items).toHaveLength(3);
  });

  it("roles with no forecast access are refused, and only targets.manage sets targets", async () => {
    const w = await world();
    await expect(getForecast(w.delivery, { now: NOW })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getForecast(w.finance, { scope: "team", now: NOW })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setTarget(w.salesA, { month: "2026-11", membershipId: w.salesA.membershipId, amount: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listMonthTargets(w.delivery, "2026-11")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a team caller without deals.view.value gets counts only, never a partial sum", async () => {
    const w = await world();
    // A custom ctx: Management's permissions minus the value permission.
    const noValue = { ...w.management, permissionKeys: w.management.permissionKeys.filter((k) => k !== "deals.view.value") };
    const f = await getForecast(noValue, { scope: "team", month: "2026-11", now: NOW });
    expect(f.valueMasked).toBe(true);
    expect(f.pipeline).toEqual({ count: 7, full: null, weighted: null });
    expect(f.buckets.every((b) => b.full === null && b.weighted === null)).toBe(true);
    expect(f.won.total).toBeNull();
    expect(f.team?.state).toBe("masked");
    expect(f.people.every((p) => p.won === null && p.weighted === null && p.state === "masked")).toBe(true);
    const text = JSON.stringify(f);
    for (const sentinel of ["1100000", "1235000", "1840000", "875000", "625000", "750000"]) expect(text).not.toContain(sentinel);
  });

  it("validates input", async () => {
    const w = await world();
    await expect(getForecast(w.management, { month: "Nov 2026" })).rejects.toBeInstanceOf(ValidationError);
    await expect(getForecast(w.management, { months: 99 })).rejects.toBeInstanceOf(ValidationError);
    await expect(setTarget(w.management, { month: "2026-11", membershipId: w.salesA.membershipId, amount: -5 })).rejects.toBeInstanceOf(ValidationError);
    await expect(setTarget(w.management, { month: "2026-11", membershipId: "not-a-member", amount: 5 })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("forecast release gate", () => {
  it("is unavailable while the release is V1", async () => {
    const org = await createTestOrganization("V1 Forecast Org");
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    process.env.ACTIVE_RELEASE = "v1";
    try {
      await expect(getForecast(sales, { now: NOW })).rejects.toMatchObject({ name: "FeatureUnavailableError" });
      await expect(listMonthTargets(sales, "2026-11")).rejects.toMatchObject({ name: "FeatureUnavailableError" });
      expect(management.permissionKeys).toContain("deals.view.value");
    } finally {
      process.env.ACTIVE_RELEASE = "v1.1";
    }
  });
});

describe("forecast tenant isolation", () => {
  it("another organisation sees none of it, in the service and under RLS", async () => {
    const a = await world();
    const other = await createTestOrganization("Other Forecast Org");
    const otherMgmt = await createTestContext(other.id, "MANAGEMENT");
    const f = await getForecast(otherMgmt, { scope: "team", month: "2026-11", now: NOW });
    expect(f.pipeline.count).toBe(0);
    expect(f.people).toEqual([]);
    expect((await listMonthTargets(otherMgmt, "2026-11")).items).toEqual([]);
    // Naming another organisation's person as a target owner is refused.
    await expect(setTarget(otherMgmt, { month: "2026-11", membershipId: a.salesA.membershipId, amount: 1 })).rejects.toBeInstanceOf(ValidationError);
    // The database itself hides and refuses rows across organisations.
    const seen = await withOrgContext(other.id, (tx) => tx.salesTarget.findMany({}));
    expect(seen).toEqual([]);
    await expect(
      withOrgContext(other.id, (tx) => tx.salesTarget.create({ data: { organizationId: a.org.id, periodStart: new Date("2026-12-01"), amount: "1.00" } })),
    ).rejects.toThrow();
  });
});
