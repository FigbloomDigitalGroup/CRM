import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import * as activityService from "../src/services/activityService";
import { createCompany } from "../src/services/companyService";
import * as dealService from "../src/services/dealService";
import * as leadService from "../src/services/leadService";
import {
  createTestContext,
  createTestOrganization,
  getLeadStatusId,
  getPipelineStageId,
} from "./helpers/fixtures";

describe("activityService", () => {
  it("requires at least one linked record", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");

    await expect(
      activityService.createActivity(ctx, { type: "NOTE", subject: "orphan" }),
    ).rejects.toThrow(ValidationError);
  });

  it("logs and lists an activity against a company in chronological order", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const { company } = await createCompany(ctx, { name: "Timeline Co" });

    const first = await activityService.createActivity(ctx, {
      type: "CALL",
      companyId: company.id,
      subject: "Intro call",
    });
    const second = await activityService.createActivity(ctx, {
      type: "NOTE",
      companyId: company.id,
      subject: "Follow-up note",
    });

    const timeline = await activityService.listActivitiesForCompany(
      ctx,
      company.id,
    );
    expect(timeline.map((a) => a.id)).toEqual([first.id, second.id]);
  });

  it("Sales cannot log an activity against a lead they do not own", async () => {
    const org = await createTestOrganization();
    const ownerCtx = await createTestContext(org.id, "SALES", "owner");
    const otherCtx = await createTestContext(org.id, "SALES", "other");
    const leadStatusId = await getLeadStatusId(org.id);
    const { lead } = await leadService.createLead(ownerCtx, { leadStatusId });

    await expect(
      activityService.createActivity(otherCtx, { type: "NOTE", leadId: lead.id }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("Sales cannot list activities for a lead they do not own", async () => {
    const org = await createTestOrganization();
    const ownerCtx = await createTestContext(org.id, "SALES", "owner");
    const otherCtx = await createTestContext(org.id, "SALES", "other");
    const leadStatusId = await getLeadStatusId(org.id);
    const { lead } = await leadService.createLead(ownerCtx, { leadStatusId });
    await activityService.createActivity(ownerCtx, {
      type: "NOTE",
      leadId: lead.id,
    });

    await expect(
      activityService.listActivitiesForLead(otherCtx, lead.id),
    ).rejects.toThrow(ForbiddenError);
  });

  it("Delivery can log an activity against a deal it can view but not edit", async () => {
    const org = await createTestOrganization();
    const salesCtx = await createTestContext(org.id, "SALES", "owner");
    const deliveryCtx = await createTestContext(org.id, "DELIVERY", "viewer");
    const { company } = await createCompany(salesCtx, { name: "Delivery Co" });
    const pipelineStageId = await getPipelineStageId(org.id);
    const deal = await dealService.createDeal(salesCtx, {
      companyId: company.id,
      pipelineStageId,
    });

    const activity = await activityService.createActivity(deliveryCtx, {
      type: "MEETING",
      dealId: deal.id,
      subject: "Handoff meeting",
    });
    expect(activity.dealId).toBe(deal.id);
  });

  it("Finance (no activities.* permission) cannot log or view activities", async () => {
    const org = await createTestOrganization();
    const salesCtx = await createTestContext(org.id, "SALES", "owner");
    const financeCtx = await createTestContext(org.id, "FINANCE", "viewer");
    const { company } = await createCompany(salesCtx, { name: "Finance Co" });

    await expect(
      activityService.createActivity(financeCtx, {
        type: "NOTE",
        companyId: company.id,
      }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      activityService.listActivitiesForCompany(financeCtx, company.id),
    ).rejects.toThrow(ForbiddenError);
  });
});
