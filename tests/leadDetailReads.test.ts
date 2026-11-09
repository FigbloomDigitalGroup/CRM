import { describe, expect, it } from "vitest";
import { NotFoundError } from "../src/auth/errors";
import { dbCallStats } from "../src/db/orgScopedClient";
import * as activityService from "../src/services/activityService";
import * as leadService from "../src/services/leadService";
import { getQualification } from "../src/services/qualificationService";
import { createTestContext, createTestOrganization, getLeadStatusId } from "./helpers/fixtures";

/** Counts the organisation-scoped transactions a call opens. */
async function callsOf(fn: () => Promise<unknown>) {
  const before = dbCallStats.orgContextCalls;
  await fn();
  return dbCallStats.orgContextCalls - before;
}

describe("lead detail reads: transactions per request and unchanged access", () => {
  it("a page of a lead's activities costs 2 organisation transactions (the lead check, then the page with its total) with the same result", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES", "owner");
    const { lead } = await leadService.createLead(ctx, { leadStatusId: await getLeadStatusId(org.id) });
    for (const subject of ["one", "two", "three"]) {
      await activityService.createActivity(ctx, { type: "NOTE", leadId: lead.id, subject });
    }

    let page: Awaited<ReturnType<typeof activityService.listActivitiesPage>> | undefined;
    const calls = await callsOf(async () => {
      page = await activityService.listActivitiesPage(ctx, { leadId: lead.id }, { page: 1, pageSize: 2 });
    });
    expect(calls).toBe(2);
    expect(page!.items.map((a) => a.subject)).toEqual(["one", "two"]);
    expect(page!.total).toBe(3);
  });

  it("the lead's activities and qualification stay hidden from a colleague who cannot see the lead, and from another organisation (404)", async () => {
    const org = await createTestOrganization();
    const owner = await createTestContext(org.id, "SALES", "owner");
    const other = await createTestContext(org.id, "SALES", "other");
    const { lead } = await leadService.createLead(owner, { leadStatusId: await getLeadStatusId(org.id) });
    await activityService.createActivity(owner, { type: "NOTE", leadId: lead.id });

    await expect(activityService.listActivitiesPage(other, { leadId: lead.id })).rejects.toThrow(NotFoundError);
    await expect(getQualification(other, lead.id)).rejects.toThrow(NotFoundError);

    const foreignOrg = await createTestOrganization();
    const foreign = await createTestContext(foreignOrg.id, "MANAGEMENT", "foreign");
    await expect(activityService.listActivitiesPage(foreign, { leadId: lead.id })).rejects.toThrow(NotFoundError);
    await expect(getQualification(foreign, lead.id)).rejects.toThrow(NotFoundError);
  });

  it("qualification still answers for the owner, with the same shape", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES", "owner");
    const { lead } = await leadService.createLead(ctx, { leadStatusId: await getLeadStatusId(org.id) });
    const view = await getQualification(ctx, lead.id);
    expect(view.leadId).toBe(lead.id);
    expect(view.progress.stages.length).toBeGreaterThan(0);
  });
});
