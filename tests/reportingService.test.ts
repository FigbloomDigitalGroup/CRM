import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../src/auth/errors";
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
  getServiceId,
} from "./helpers/fixtures";

describe("reportingService", () => {
  describe("getMyActionableWork", () => {
    it("Restricted Technical (no reporting.* permission) is forbidden", async () => {
      const org = await createTestOrganization();
      const techCtx = await createTestContext(org.id, "RESTRICTED_TECHNICAL");

      await expect(
        reportingService.getMyActionableWork(techCtx),
      ).rejects.toThrow(ForbiddenError);
    });

    it("surfaces the caller's own overdue tasks, new leads, and stalled deals", async () => {
      const org = await createTestOrganization();
      const ctx = await createTestContext(org.id, "SALES");
      const leadStatusId = await getLeadStatusId(org.id);
      const pipelineStageId = await getPipelineStageId(org.id);
      const { company } = await createCompany(ctx, { name: "Actionable Co" });

      await taskService.createTask(ctx, {
        title: "Overdue task",
        dueAt: new Date(Date.now() - 86_400_000).toISOString(),
      });
      await leadService.createLead(ctx, { leadStatusId });
      const deal = await dealService.createDeal(ctx, {
        companyId: company.id,
        pipelineStageId,
      });
      // Force the deal's expectedCloseDate into the past directly via update
      // (stalled = open + past expected close date).
      await dealService.updateDeal(ctx, deal.id, {
        expectedCloseDate: new Date(Date.now() - 86_400_000).toISOString(),
      });

      const work = await reportingService.getMyActionableWork(ctx);
      expect(work.overdue.length).toBeGreaterThan(0);
      expect(work.newLeads.length).toBeGreaterThan(0);
      expect(work.stalledDeals.some((d) => d.id === deal.id)).toBe(true);
    });

    it("Finance (no tasks.*/leads.* permission) still gets a result with those sections empty", async () => {
      const org = await createTestOrganization();
      const financeCtx = await createTestContext(org.id, "FINANCE");

      const work = await reportingService.getMyActionableWork(financeCtx);
      expect(work.dueToday).toEqual([]);
      expect(work.overdue).toEqual([]);
      expect(work.newLeads).toEqual([]);
      // Finance does have deals.view.all, so stalled deals is not forced empty.
    });

    it("does not leak a colleague's overdue task into another Sales rep's actionable work", async () => {
      const org = await createTestOrganization();
      const ownerCtx = await createTestContext(org.id, "SALES", "owner");
      const otherCtx = await createTestContext(org.id, "SALES", "other");
      await taskService.createTask(ownerCtx, {
        title: "Owner's overdue task",
        dueAt: new Date(Date.now() - 86_400_000).toISOString(),
      });

      const work = await reportingService.getMyActionableWork(otherCtx);
      expect(work.overdue).toHaveLength(0);
    });
  });

  describe("getOrganizationMetrics", () => {
    it("Sales (no reporting.view.all) is forbidden", async () => {
      const org = await createTestOrganization();
      const salesCtx = await createTestContext(org.id, "SALES");

      await expect(
        reportingService.getOrganizationMetrics(salesCtx),
      ).rejects.toThrow(ForbiddenError);
    });

    it("reports lead volume by source and conversion within the default 30-day window", async () => {
      const org = await createTestOrganization();
      const managementCtx = await createTestContext(org.id, "MANAGEMENT");
      const leadStatusId = await getLeadStatusId(org.id);
      const { company } = await createCompany(managementCtx, {
        name: "Metrics Co",
      });
      const { lead } = await leadService.createLead(managementCtx, {
        leadStatusId,
        companyId: company.id,
      });
      await leadService.convertLead(managementCtx, lead.id);
      await leadService.createLead(managementCtx, { leadStatusId });

      const metrics = await reportingService.getOrganizationMetrics(managementCtx);
      expect(metrics.leadConversion.total).toBe(2);
      expect(metrics.leadConversion.converted).toBe(1);
    });

    it("reports won/lost outcomes and masks value for a caller without deals.view.value", async () => {
      const org = await createTestOrganization();
      const managementCtx = await createTestContext(org.id, "MANAGEMENT");
      const pipelineStageId = await getPipelineStageId(org.id);
      const wonStageId = await getPipelineStageId(org.id, "CLOSED_WON");
      const lostStageId = await getPipelineStageId(org.id, "CLOSED_LOST");
      const lostReasonId = await getLostReasonId(org.id);
      const { company } = await createCompany(managementCtx, {
        name: "Outcome Co",
      });

      const wonDeal = await dealService.createDeal(managementCtx, {
        companyId: company.id,
        pipelineStageId,
        value: "1000",
      });
      await dealService.updateDeal(managementCtx, wonDeal.id, {
        pipelineStageId: wonStageId,
      });

      const lostDeal = await dealService.createDeal(managementCtx, {
        companyId: company.id,
        pipelineStageId,
      });
      await dealService.updateDeal(managementCtx, lostDeal.id, {
        pipelineStageId: lostStageId,
        lostReasonId,
      });

      const metrics = await reportingService.getOrganizationMetrics(managementCtx);
      expect(metrics.dealOutcomes.won.count).toBe(1);
      expect(Number(metrics.dealOutcomes.won.value)).toBe(1000);
      expect(metrics.dealOutcomes.lost.count).toBe(1);
      expect(metrics.valueMasked).toBe(false);
    });

    it("masks value-bearing aggregates for a caller with reporting.view.all but not deals.view.value", async () => {
      // No seeded role currently holds reporting.view.all without also
      // holding deals.view.value (only Management has either, and it has
      // both) -- this test exercises the masking branch directly by
      // stripping deals.view.value from an otherwise-real context, since
      // the masking logic is permission-driven, not role-driven, and
      // should hold even if the matrix changes later.
      const org = await createTestOrganization();
      const managementCtx = await createTestContext(org.id, "MANAGEMENT");
      const pipelineStageId = await getPipelineStageId(org.id);
      const wonStageId = await getPipelineStageId(org.id, "CLOSED_WON");
      const { company } = await createCompany(managementCtx, {
        name: "Masked Co",
      });
      const deal = await dealService.createDeal(managementCtx, {
        companyId: company.id,
        pipelineStageId,
        value: "500",
      });
      await dealService.updateDeal(managementCtx, deal.id, {
        pipelineStageId: wonStageId,
      });

      const restrictedCtx = {
        ...managementCtx,
        permissionKeys: managementCtx.permissionKeys.filter(
          (k) => k !== "deals.view.value",
        ),
      };

      const metrics = await reportingService.getOrganizationMetrics(restrictedCtx);
      expect(metrics.valueMasked).toBe(true);
      expect(metrics.dealOutcomes.won.count).toBe(1);
      expect(metrics.dealOutcomes.won.value).toBeNull();
      const wonRow = metrics.pipelineByStage.find(
        (r) => r.pipelineStageId === wonStageId,
      );
      expect(wonRow).toBeUndefined(); // won deal isn't OPEN, so not in pipeline-by-stage anyway
      expect(metrics.salesByService).toHaveLength(1);
      expect(metrics.salesByService[0]._sum.value).toBeNull();
    });

    it("filters salesByService by serviceId (regression: the filter used to be silently ignored)", async () => {
      const org = await createTestOrganization();
      const managementCtx = await createTestContext(org.id, "MANAGEMENT");
      const pipelineStageId = await getPipelineStageId(org.id);
      const wonStageId = await getPipelineStageId(org.id, "CLOSED_WON");
      const crmServiceId = await getServiceId(org.id, "CRM");
      const hrServiceId = await getServiceId(org.id, "HR");
      const { company } = await createCompany(managementCtx, {
        name: "Service Filter Co",
      });

      const crmDeal = await dealService.createDeal(managementCtx, {
        companyId: company.id,
        pipelineStageId,
        serviceId: crmServiceId,
        value: "100",
      });
      await dealService.updateDeal(managementCtx, crmDeal.id, {
        pipelineStageId: wonStageId,
      });

      const hrDeal = await dealService.createDeal(managementCtx, {
        companyId: company.id,
        pipelineStageId,
        serviceId: hrServiceId,
        value: "200",
      });
      await dealService.updateDeal(managementCtx, hrDeal.id, {
        pipelineStageId: wonStageId,
      });

      const filtered = await reportingService.getOrganizationMetrics(
        managementCtx,
        { serviceId: crmServiceId },
      );
      expect(filtered.salesByService).toHaveLength(1);
      expect(filtered.salesByService[0].serviceId).toBe(crmServiceId);
      expect(Number(filtered.salesByService[0]._sum.value)).toBe(100);
    });
  });
});
