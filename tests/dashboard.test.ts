import { describe, expect, it, vi } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ForbiddenError, NotFoundError } from "../src/auth/errors";
import { createCompany } from "../src/services/companyService";
import { availableSections, getDashboard, loadSection } from "../src/services/dashboardService";
import { createDeal } from "../src/services/dealService";
import { createLead } from "../src/services/leadService";
import * as signalService from "../src/services/signalService";
import { createTask } from "../src/services/taskService";
import { createTestContext, createTestOrganization, getLeadStatusId, getPipelineStageId } from "./helpers/fixtures";

const DAY = 24 * 60 * 60_000;
const SENTINEL = 7654321;

async function setup() {
  const org = await createTestOrganization("Dash");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const salesA = await createTestContext(org.id, "SALES", "a");
  const salesB = await createTestContext(org.id, "SALES", "b");
  const delivery = await createTestContext(org.id, "DELIVERY");
  const finance = await createTestContext(org.id, "FINANCE");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
  const statusId = await getLeadStatusId(org.id);
  const stageId = await getPipelineStageId(org.id);
  const { company } = await createCompany(management, { name: "Dash Co" });
  return { org, management, salesA, salesB, delivery, finance, technical, statusId, stageId, company };
}

const keys = (ctx: Parameters<typeof availableSections>[0]) => availableSections(ctx).map((s) => s.key);

describe("role dashboards (FIG-1042, B2.13)", () => {
  it("each role gets exactly its sections; the others are absent, not empty", async () => {
    const { management, salesA, delivery, finance, technical } = await setup();
    expect(keys(management)).toEqual(["management", "delivery", "finance"]);
    expect(keys(salesA)).toEqual(["sales_today", "my_metrics"]);
    expect(keys(delivery)).toEqual(["delivery", "my_metrics"]);
    expect(keys(finance)).toEqual(["finance", "my_metrics"]);
    expect(keys(technical)).toEqual(["technical"]);

    const dash = await getDashboard(salesA);
    expect(dash.sections.map((s) => s.key)).toEqual(["sales_today", "my_metrics"]);
    expect(dash.sections.every((s) => s.ok && s.scope.length > 0)).toBe(true);
    await expect(loadSection(technical, "management")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("Sales Today has the right totals for known fixtures and counts only the caller's own records", async () => {
    const { salesA, salesB, statusId, stageId, company } = await setup();
    for (let i = 0; i < 2; i += 1) await createLead(salesA, { leadStatusId: statusId, temperature: "HOT" });
    await createLead(salesA, { leadStatusId: statusId, temperature: "COLD" });
    await createLead(salesB, { leadStatusId: statusId, temperature: "HOT" });
    await createDeal(salesA, { companyId: company.id, pipelineStageId: stageId });
    const old = await createDeal(salesA, { companyId: company.id, pipelineStageId: stageId });
    await adminDb.deal.update({ where: { id: old.id }, data: { lastActivityAt: new Date(Date.now() - 300 * DAY) } });
    await createTask(salesA, { title: "Late", dueAt: new Date(Date.now() - 2 * DAY).toISOString() });
    await createTask(salesB, { title: "Theirs", dueAt: new Date(Date.now() - 2 * DAY).toISOString() });

    const section = await loadSection(salesA, "sales_today");
    expect(section.ok).toBe(true);
    const data = (section as { data: Record<string, any> }).data;
    expect(data.hotLeads.count).toBe(2);
    expect(data.hotLeads.top).toHaveLength(2);
    expect(data.myDay.tasksOverdue).toBe(1);
    expect(data.stalledDeals).toBe(1);
    expect(data.pipeline).toMatchObject({ open: 2 });
    expect(data.quickActions.map((a: { key: string }) => a.key)).toContain("new_lead");
  });

  it("no section carries another person's record or a value the role may not see", async () => {
    const { management, salesA, salesB, delivery, finance, technical, stageId, company } = await setup();
    await createDeal(salesB, { companyId: company.id, pipelineStageId: stageId, value: SENTINEL } as never);
    await createTask(salesB, { title: "Sentinel task", dueAt: new Date(Date.now() - DAY).toISOString() });

    for (const [name, ctx] of [["sales A", salesA], ["delivery", delivery], ["technical", technical]] as const) {
      const text = JSON.stringify(await getDashboard(ctx));
      expect(text, name).not.toContain(String(SENTINEL));
      expect(text, name).not.toContain(salesB.membershipId);
    }
    expect(JSON.stringify(await getDashboard(management))).toContain(String(SENTINEL));
    expect(JSON.stringify(await getDashboard(finance))).toBeDefined();
  });

  it("Management sees this month against last, team workload and overdue by owner", async () => {
    const { management, salesA, salesB, statusId } = await setup();
    await createLead(salesA, { leadStatusId: statusId });
    await createLead(salesA, { leadStatusId: statusId });
    await createTask(salesA, { title: "Open A" });
    await createTask(salesB, { title: "Late B", dueAt: new Date(Date.now() - DAY).toISOString() });
    const section = await loadSection(management, "management", new Date(Date.now() + 11 * 60_000));
    expect(section.ok).toBe(true);
    const data = (section as { data: Record<string, any> }).data;
    expect(data.thisMonth.metrics).toBeDefined();
    expect(data.lastMonth.from < data.thisMonth.from).toBe(true);
    expect(data.pipelineByStage).toBeDefined();
    const workload = data.teamWorkload as { membershipId: string; openTasks: number; overdueTasks: number }[];
    expect(workload.find((w) => w.membershipId === salesA.membershipId)?.openTasks).toBe(1);
    expect(workload.find((w) => w.membershipId === salesB.membershipId)).toMatchObject({ openTasks: 1, overdueTasks: 1 });
    expect(data.overdueByOwner.tasks.byOwner.find((o: { membershipId: string }) => o.membershipId === salesB.membershipId).count).toBe(1);
    expect(data.adoption.weeks).toHaveLength(4);
  });

  it("Delivery, Finance and Technical show their own numbers", async () => {
    const { org, management, delivery, finance, technical } = await setup();
    const technicalTask = await createTask(management, { title: "Install", assigneeMembershipId: technical.membershipId, dueAt: new Date(Date.now() - DAY).toISOString() } as never);
    void technicalTask;
    const deliveryData = ((await loadSection(delivery, "delivery")) as { data: Record<string, any> }).data;
    expect(deliveryData).toMatchObject({ awaitingOwner: 0, onboardingInProgress: 0 });
    const financeData = ((await loadSection(finance, "finance")) as { data: Record<string, any> }).data;
    expect(financeData.payments.available).toBe(false);
    const techData = ((await loadSection(technical, "technical")) as { data: Record<string, any> }).data;
    expect(techData.counts.OVERDUE).toBe(1);
    expect(JSON.stringify(techData)).not.toContain("Install"); // counts only
    void org;
  });

  it("one failing section is reported in place and the others still load", async () => {
    const { management } = await setup();
    const spy = vi.spyOn(signalService, "getSignals").mockRejectedValue(new Error("boom"));
    try {
      const dash = await getDashboard(management);
      const byKey = Object.fromEntries(dash.sections.map((s) => [s.key, s]));
      expect(byKey.management!.ok).toBe(false);
      expect((byKey.management as { error: string }).error).not.toContain("boom");
      expect(byKey.delivery!.ok).toBe(true);
      expect(byKey.finance!.ok).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("is isolated per organisation", async () => {
    const a = await setup();
    const b = await setup();
    await createTask(a.salesA, { title: "Only in A", dueAt: new Date(Date.now() - DAY).toISOString() });
    const data = ((await loadSection(b.management, "management", new Date(Date.now() + 11 * 60_000))) as { data: Record<string, any> }).data;
    expect(data.teamWorkload).toEqual([]);
    void NotFoundError;
  });
});
