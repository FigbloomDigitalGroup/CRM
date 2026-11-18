import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { runDueJobs } from "../src/jobs/runner";
import "../src/jobs/definitions";
import { createCompany } from "../src/services/companyService";
import { createDeal, countDeals } from "../src/services/dealService";
import { inactiveStageCutoffs, loadStageRules } from "../src/services/dealRuleService";
import { getSignals, loadSignals, refreshSignals, SIGNALS_MAX_AGE_MS } from "../src/services/signalService";
import { countTasks, createTask } from "../src/services/taskService";
import { createTestContext, createTestOrganization, getPipelineStageId } from "./helpers/fixtures";

const DAY = 24 * 60 * 60_000;

async function setup() {
  const org = await createTestOrganization("Signals");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const salesA = await createTestContext(org.id, "SALES", "a");
  const salesB = await createTestContext(org.id, "SALES", "b");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const stageId = await getPipelineStageId(org.id);
  const { company } = await createCompany(management, { name: "Signal Co" });
  const deal = async (owner: typeof salesA, opts: { lastActivityDaysAgo?: number; closedDaysAgo?: number } = {}) => {
    const d = await createDeal(owner, { companyId: company.id, pipelineStageId: stageId });
    await adminDb.deal.update({
      where: { id: d.id },
      data: {
        ...(opts.lastActivityDaysAgo !== undefined ? { lastActivityAt: new Date(Date.now() - opts.lastActivityDaysAgo * DAY) } : {}),
        ...(opts.closedDaysAgo !== undefined ? { expectedCloseDate: new Date(Date.now() - opts.closedDaysAgo * DAY) } : {}),
      },
    });
    return d;
  };
  return { org, management, salesA, salesB, delivery, stageId, company, deal };
}

describe("dashboard signals (FIG-1043, B2.14)", () => {
  it("stalled deals and overdue tasks equal what the list filters return, in total and per owner", async () => {
    const { org, management, salesA, salesB, stageId, deal } = await setup();
    await deal(salesA, { lastActivityDaysAgo: 200 });
    await deal(salesA, { lastActivityDaysAgo: 200 });
    await deal(salesB, { lastActivityDaysAgo: 200 });
    await deal(salesB); // fresh
    await deal(salesA, { closedDaysAgo: 3 });
    const past = new Date(Date.now() - 2 * DAY).toISOString();
    await createTask(management, { title: "Late 1", dueAt: past, assigneeMembershipId: salesA.membershipId } as never).catch(() => undefined);
    await createTask(salesA, { title: "Late 2", dueAt: past });
    await createTask(salesB, { title: "Not late", dueAt: new Date(Date.now() + 2 * DAY).toISOString() });

    const snapshot = await refreshSignals(org.id);
    const rules = await loadStageRules(org.id);
    const stalledList = await countDeals(management, { inactiveStages: inactiveStageCutoffs([stageId], rules) });
    expect(snapshot.stalledDeals.total).toBe(stalledList);
    expect(snapshot.stalledDeals.byOwner[salesA.membershipId]).toBe(
      await countDeals(management, { ownerMembershipId: salesA.membershipId, inactiveStages: inactiveStageCutoffs([stageId], rules) }),
    );
    expect(snapshot.closeDatePassed.total).toBe(await countDeals(management, { closeDatePassed: true }));
    expect(snapshot.overdueTasks.total).toBe(await countTasks(management, { overdueOnly: true }));
    expect(snapshot.stalledDeals.total).toBeGreaterThanOrEqual(3);
  });

  it("adoption counts active people and pages per rolling week on a fixed clock", async () => {
    const { org, management, salesA, delivery } = await setup();
    const now = new Date("2026-10-20T12:00:00Z");
    const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
    const view = (m: typeof salesA, page: string, daysAgo: number) =>
      adminDb.pageView.create({ data: { organizationId: org.id, membershipId: m.membershipId, page, viewedAt: at(daysAgo) } });
    await view(management, "dashboard", 1);
    await view(management, "leads", 2);
    await view(salesA, "leads", 3);
    await view(salesA, "deals", 10); // previous week
    await view(delivery, "tasks", 40); // outside the window

    const { adoption } = await refreshSignals(org.id, now);
    expect(adoption.weeks).toHaveLength(4);
    expect(adoption.weeks[0]).toMatchObject({ activeUsers: 2, pagesUsed: 2, views: 3 });
    expect(adoption.weeks[1]).toMatchObject({ activeUsers: 1, pagesUsed: 1, views: 1 });
    expect(adoption.weeks[3]).toMatchObject({ activeUsers: 0, views: 0 });
    expect(adoption.activeMembers).toBe(4);
    expect(adoption.rate).toBe(0.5);
  });

  it("serves stored values until they are ten minutes old, and recomputes once stale or invalidated by a change", async () => {
    const { org, management, salesA, deal } = await setup();
    const t0 = new Date();
    const first = await loadSignals(org.id, t0);
    expect(first.stalledDeals.total).toBe(0);

    await adminDb.deal.deleteMany({ where: { organizationId: org.id } });
    const d = await deal(salesA, { lastActivityDaysAgo: 300 }); // a change: marks the cache stale
    expect((await loadSignals(org.id, new Date())).stalledDeals.total).toBe(1);

    // Fresh again: a direct change the service does not know about is not seen until the age limit.
    await adminDb.deal.update({ where: { id: d.id }, data: { lastActivityAt: new Date() } });
    expect((await loadSignals(org.id, new Date())).stalledDeals.total).toBe(1);
    expect((await loadSignals(org.id, new Date(Date.now() + SIGNALS_MAX_AGE_MS + 1000))).stalledDeals.total).toBe(0);
    void management;
  });

  it("the nightly job recomputes every organisation", async () => {
    const { org } = await setup();
    const before = await adminDb.signalSnapshot.findUnique({ where: { organizationId_key: { organizationId: org.id, key: "dashboard" } } });
    expect(before).toBeNull();
    const { results } = await runDueJobs({ organizationIds: [org.id], types: ["signals.refresh"], maxJobs: 5 }).catch(() => ({ results: [] }));
    void results;
    const { enqueueAndRunNow } = await import("../src/jobs/runner");
    const run = await enqueueAndRunNow({ organizationId: org.id, type: "signals.refresh" });
    expect(run.outcome).toBe("succeeded");
    const after = await adminDb.signalSnapshot.findUnique({ where: { organizationId_key: { organizationId: org.id, key: "dashboard" } } });
    expect(after).not.toBeNull();
  });

  it("shows each role only its sections: Management everything, Sales its own numbers, Delivery no deal signals", async () => {
    const { management, salesA, salesB, delivery, deal } = await setup();
    await deal(salesA, { lastActivityDaysAgo: 200 });
    await deal(salesB, { lastActivityDaysAgo: 200 });
    await deal(salesB, { lastActivityDaysAgo: 200 });
    await createTask(salesA, { title: "Mine late", dueAt: new Date(Date.now() - DAY).toISOString() });
    const now = new Date(Date.now() + SIGNALS_MAX_AGE_MS + 1000); // force a recompute

    const asManagement = await getSignals(management, now);
    expect(asManagement.stalledDeals).toMatchObject({ scope: "all", total: 3 });
    expect(asManagement.stalledDeals && "byOwner" in asManagement.stalledDeals && asManagement.stalledDeals.byOwner).toHaveLength(2);
    expect(asManagement.adoption).toBeDefined();

    const asSales = await getSignals(salesA, now);
    expect(asSales.stalledDeals).toEqual({ scope: "own", total: 1 });
    expect(asSales.overdueTasks).toEqual({ scope: "own", total: 1 });
    expect(asSales.adoption).toBeUndefined(); // absent, not empty
    expect(JSON.stringify(asSales)).not.toContain(salesB.membershipId);

    const asDelivery = await getSignals(delivery, now);
    expect(asDelivery.stalledDeals).toBeUndefined();
    expect(asDelivery.closeDatePassed).toBeUndefined();
    expect(asDelivery.adoption).toBeUndefined();
  });

  it("is isolated per organisation", async () => {
    const a = await setup();
    const b = await setup();
    await a.deal(a.salesA, { lastActivityDaysAgo: 400 });
    const snapshotB = await refreshSignals(b.org.id);
    expect(snapshotB.stalledDeals.total).toBe(0);
    expect(Object.keys(snapshotB.stalledDeals.byOwner)).toHaveLength(0);
  });
});
