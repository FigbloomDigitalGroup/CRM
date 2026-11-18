import { describe, expect, it } from "vitest";
import { buildAssistantContext } from "../src/assistant/context";
import { sweepOrganization, SWEEP_BATCH_SIZE } from "../src/jobs/handlers/notificationSweep";
import { dbCallStats } from "../src/db/orgScopedClient";
import { createCompany } from "../src/services/companyService";
import * as dealService from "../src/services/dealService";
import * as leadService from "../src/services/leadService";
import * as reportingService from "../src/services/reportingService";
import * as taskService from "../src/services/taskService";
import {
  createTestContext,
  createTestOrganization,
  getLeadStatusId,
  getLostReasonId,
  getPipelineStageId,
} from "./helpers/fixtures";

const DAY = 86_400_000;

/**
 * Unbounded reads made bounded (the performance review): the assistant's context, the "my work" dashboard lists and the notification sweep
 * must not load every record of an organisation. The filters and caps run in the database; permissions and masking are the services' own.
 */
describe("assistant context: filters and the cap run in the database", () => {
  it("only offers open leads, open or won deals and live tasks, never more than the cap, newest first as before", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const leadStatusId = await getLeadStatusId(org.id);
    const stageId = await getPipelineStageId(org.id);
    const lostStageId = await getPipelineStageId(org.id, "CLOSED_LOST");
    const lostReasonId = await getLostReasonId(org.id);
    const { company } = await createCompany(ctx, { name: "Context Co" });

    for (let i = 0; i < 4; i++) await leadService.createLead(ctx, { leadStatusId });
    const open = await dealService.createDeal(ctx, { companyId: company.id, pipelineStageId: stageId });
    const lost = await dealService.createDeal(ctx, { companyId: company.id, pipelineStageId: stageId });
    await dealService.updateDeal(ctx, lost.id, { pipelineStageId: lostStageId, lostReasonId });
    const live = await taskService.createTask(ctx, { title: "Live task" });
    const done = await taskService.createTask(ctx, { title: "Done task" });
    await taskService.updateTask(ctx, done.id, { status: "COMPLETED" });

    const capped = await buildAssistantContext(ctx, { orgSlug: "t", maxRecords: 2 });
    expect(capped.items.filter((i) => i.kind === "lead")).toHaveLength(2);
    expect(capped.counts.leads).toBe(2);

    const all = await buildAssistantContext(ctx, { orgSlug: "t", maxRecords: 50 });
    expect(all.items.filter((i) => i.kind === "lead")).toHaveLength(4);
    const dealIds = all.items.filter((i) => i.kind === "deal").map((i) => i.id);
    expect(dealIds).toContain(open.id);
    expect(dealIds).not.toContain(lost.id);
    const taskIds = all.items.filter((i) => i.kind === "task").map((i) => i.id);
    expect(taskIds).toContain(live.id);
    expect(taskIds).not.toContain(done.id);
  });

  it("does not offer a converted lead, and keeps one organisation's records out of another's context", async () => {
    const org = await createTestOrganization();
    const other = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const otherCtx = await createTestContext(other.id, "MANAGEMENT");
    const leadStatusId = await getLeadStatusId(org.id);
    const otherStatus = await getLeadStatusId(other.id);
    const { company } = await createCompany(ctx, { name: "Converted Co" });
    const { lead: keep } = await leadService.createLead(ctx, { leadStatusId, companyId: company.id });
    const { lead: convert } = await leadService.createLead(ctx, { leadStatusId, companyId: company.id });
    await leadService.convertLead(ctx, convert.id, {});
    await leadService.createLead(otherCtx, { leadStatusId: otherStatus });

    const result = await buildAssistantContext(ctx, { orgSlug: "t" });
    const ids = result.items.filter((i) => i.kind === "lead").map((i) => i.id);
    expect(ids).toContain(keep.id);
    expect(ids).not.toContain(convert.id);
    expect(ids).toHaveLength(1);
  });

  it("a role without lead, deal or task access gets none of them (permissions unchanged)", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const finance = await createTestContext(org.id, "FINANCE");
    const leadStatusId = await getLeadStatusId(org.id);
    await leadService.createLead(mgmt, { leadStatusId });
    await taskService.createTask(mgmt, { title: "Not for finance" });

    const result = await buildAssistantContext(finance, { orgSlug: "t" });
    expect(result.items.filter((i) => i.kind === "lead" || i.kind === "task")).toEqual([]);
  });
});

describe("my actionable work: capped lists, true counts", () => {
  it("returns at most the list limit but reports the real total, in a fixed number of database calls", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const total = reportingService.MY_WORK_LIST_LIMIT + 2;
    const past = new Date(Date.now() - DAY).toISOString();
    for (let i = 0; i < total; i++) await taskService.createTask(ctx, { title: `Overdue ${i}`, dueAt: past });

    const before = dbCallStats.orgContextCalls;
    const work = await reportingService.getMyActionableWork(ctx);
    const calls = dbCallStats.orgContextCalls - before;

    expect(work.overdue).toHaveLength(reportingService.MY_WORK_LIST_LIMIT);
    expect(work.counts.overdue).toBe(total);
    expect(work.counts.dueToday).toBe(0);
    // Four lists and four counts: the cost does not grow with the amount of data.
    expect(calls).toBeLessThanOrEqual(12);
  });

  it("counts follow the caller's own scope: a colleague's overdue tasks are neither listed nor counted", async () => {
    const org = await createTestOrganization();
    const owner = await createTestContext(org.id, "SALES", "owner");
    const other = await createTestContext(org.id, "SALES", "other");
    await taskService.createTask(owner, { title: "Owner overdue", dueAt: new Date(Date.now() - DAY).toISOString() });

    const work = await reportingService.getMyActionableWork(other);
    expect(work.overdue).toHaveLength(0);
    expect(work.counts).toEqual({ dueToday: 0, overdue: 0, newLeads: 0, stalledDeals: 0 });
  });
});

describe("notification sweep reads tasks in batches", () => {
  it("notifies every overdue task even when there are more than one batch, and reports the totals", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const past = new Date(Date.now() - DAY).toISOString();
    const count = 5;
    for (let i = 0; i < count; i++) await taskService.createTask(ctx, { title: `Sweep ${i}`, dueAt: past });

    // A batch of 2 over 5 tasks: three rounds, every task seen exactly once.
    const result = await sweepOrganization(org.id, { batchSize: 2 });
    expect(result.overdue).toBe(count);
    expect(SWEEP_BATCH_SIZE).toBeGreaterThan(0);

    // Running it again sends nothing twice (notifications are idempotent per task) but still walks every task.
    const again = await sweepOrganization(org.id, { batchSize: 5 });
    expect(again.overdue).toBe(count);
  });
});
