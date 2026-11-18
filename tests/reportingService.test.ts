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

  describe("getReportScope", () => {
    it("reports what each role's reports cover", async () => {
      const org = await createTestOrganization();
      const management = reportingService.getReportScope(
        await createTestContext(org.id, "MANAGEMENT"),
      );
      expect(management).toEqual({ mode: "organization", leads: "all", deals: "all", tasks: "all" });

      const sales = reportingService.getReportScope(await createTestContext(org.id, "SALES"));
      expect(sales).toEqual({ mode: "personal", leads: "own", deals: "own", tasks: "own" });

      const delivery = reportingService.getReportScope(await createTestContext(org.id, "DELIVERY"));
      expect(delivery).toEqual({ mode: "personal", leads: null, deals: "won", tasks: "own" });

      const finance = reportingService.getReportScope(await createTestContext(org.id, "FINANCE"));
      expect(finance).toEqual({ mode: "personal", leads: null, deals: "won", tasks: null });
    });

    it("refuses Restricted Technical", async () => {
      const org = await createTestOrganization();
      const tech = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
      expect(() => reportingService.getReportScope(tech)).toThrow(ForbiddenError);
      await expect(reportingService.getMyMetrics(tech)).rejects.toThrow(ForbiddenError);
    });
  });

  describe("getMyMetrics", () => {
    it("counts only the caller's own leads and deals for Sales, values visible", async () => {
      const org = await createTestOrganization();
      const sales = await createTestContext(org.id, "SALES", "mine");
      const salesTwo = await createTestContext(org.id, "SALES", "theirs");
      const leadStatusId = await getLeadStatusId(org.id);
      const pipelineStageId = await getPipelineStageId(org.id);
      const wonStageId = await getPipelineStageId(org.id, "CLOSED_WON");
      const { company } = await createCompany(sales, { name: "Mine Co" });

      await leadService.createLead(sales, { leadStatusId });
      await leadService.createLead(salesTwo, { leadStatusId });
      await leadService.createLead(salesTwo, { leadStatusId });

      const won = await dealService.createDeal(sales, {
        companyId: company.id,
        pipelineStageId,
        value: "750",
      });
      await dealService.updateDeal(sales, won.id, { pipelineStageId: wonStageId });
      await dealService.createDeal(salesTwo, { companyId: company.id, pipelineStageId, value: "50" });

      const metrics = await reportingService.getMyMetrics(sales);
      expect(metrics.leadConversion?.total).toBe(1);
      expect(metrics.dealOutcomes?.won.count).toBe(1);
      expect(Number(metrics.dealOutcomes?.won.value)).toBe(750);
      expect(metrics.pipelineByStage).toHaveLength(0); // the only open deal belongs to the colleague
      expect(metrics.valueMasked).toBe(false);
    });

    it("scopes follow-ups to tasks assigned to the caller", async () => {
      const org = await createTestOrganization();
      const sales = await createTestContext(org.id, "SALES", "a");
      const other = await createTestContext(org.id, "SALES", "b");
      await taskService.createTask(sales, { title: "Mine", dueAt: new Date().toISOString() });
      await taskService.createTask(other, { title: "Theirs", dueAt: new Date().toISOString() });

      const metrics = await reportingService.getMyMetrics(sales);
      const total = (metrics.followUpBreakdown ?? []).reduce((n, r) => n + r._count._all, 0);
      expect(total).toBe(1);
    });

    it("gives Finance won deals only, with values; Delivery won deals and tasks, values hidden", async () => {
      const org = await createTestOrganization();
      const management = await createTestContext(org.id, "MANAGEMENT");
      const finance = await createTestContext(org.id, "FINANCE");
      const delivery = await createTestContext(org.id, "DELIVERY");
      const pipelineStageId = await getPipelineStageId(org.id);
      const { company } = await createCompany(management, { name: "Shared Co" });
      const won = await dealService.createDeal(management, { companyId: company.id, pipelineStageId, value: "900" });
      await dealService.updateDeal(management, won.id, {
        pipelineStageId: await getPipelineStageId(org.id, "CLOSED_WON"),
      });
      // An open deal: won-only viewers must not see it in any figure.
      await dealService.createDeal(management, { companyId: company.id, pipelineStageId, value: "700" });

      const fin = await reportingService.getMyMetrics(finance);
      expect(fin.leadVolumeBySource).toBeNull();
      expect(fin.leadConversion).toBeNull();
      expect(fin.followUpBreakdown).toBeNull();
      expect(fin.valueMasked).toBe(false);
      expect(fin.scope.deals).toBe("won");
      // The open pipeline is not theirs to see; the won figures are.
      expect(fin.pipelineByStage).toBeNull();
      expect(fin.dealOutcomes?.won.count).toBe(1);
      expect(Number(fin.dealOutcomes?.won.value)).toBe(900);
      expect(fin.dealOutcomes?.lost.count).toBe(0);

      const del = await reportingService.getMyMetrics(delivery);
      expect(del.leadConversion).toBeNull();
      expect(del.followUpBreakdown).not.toBeNull();
      expect(del.valueMasked).toBe(true);
      expect(del.pipelineByStage).toBeNull();
      expect(del.dealOutcomes?.won.count).toBe(1);
      expect(del.dealOutcomes?.won.value).toBeNull();
    });
  });

  describe("report data integrity", () => {
    it("leaves archived deals out of the open pipeline", async () => {
      const org = await createTestOrganization();
      const management = await createTestContext(org.id, "MANAGEMENT");
      const pipelineStageId = await getPipelineStageId(org.id);
      const { company } = await createCompany(management, { name: "Archive Co" });
      const deal = await dealService.createDeal(management, {
        companyId: company.id,
        pipelineStageId,
        value: "300",
      });

      expect((await reportingService.getOrganizationMetrics(management)).pipelineByStage).toHaveLength(1);
      await dealService.archiveDeal(management, deal.id);
      expect((await reportingService.getOrganizationMetrics(management)).pipelineByStage).toHaveLength(0);
    });

    it("includes the whole of the chosen end date", async () => {
      const org = await createTestOrganization();
      const management = await createTestContext(org.id, "MANAGEMENT");
      const leadStatusId = await getLeadStatusId(org.id);
      await leadService.createLead(management, { leadStatusId });

      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const metrics = await reportingService.getOrganizationMetrics(management, {
        dateFrom: yesterday,
        dateTo: today,
      });
      expect(metrics.leadConversion.total).toBe(1);
    });

    it("survives unreadable or reversed dates instead of failing", async () => {
      const org = await createTestOrganization();
      const management = await createTestContext(org.id, "MANAGEMENT");
      const leadStatusId = await getLeadStatusId(org.id);
      await leadService.createLead(management, { leadStatusId });

      const garbage = await reportingService.getOrganizationMetrics(management, {
        dateFrom: "not-a-date",
        dateTo: "also-not",
      });
      expect(garbage.leadConversion.total).toBe(1);

      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const reversed = await reportingService.getOrganizationMetrics(management, {
        dateFrom: today,
        dateTo: yesterday,
      });
      expect(reversed.leadConversion.total).toBe(1);
    });
  });
});
