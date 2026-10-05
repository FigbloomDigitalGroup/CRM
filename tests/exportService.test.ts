import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import * as exportService from "../src/services/exportService";
import { createCompany } from "../src/services/companyService";
import { createDeal, updateDeal } from "../src/services/dealService";
import { createLead } from "../src/services/leadService";
import {
  createTestContext,
  createTestOrganization,
  getLeadStatusId,
  getPipelineStageId,
  getServiceId,
} from "./helpers/fixtures";

async function collectRows(csv: exportService.CsvExport) {
  const rows: Record<string, unknown>[] = [];
  for await (const row of csv.rows) rows.push(row);
  return rows;
}

describe("exportService: companies", () => {
  it("rejects export for a role without companies.export", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");

    await expect(exportService.exportCompaniesCsv(ctx)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("includes the resolved owner email and lifecycle state name, and records an audit event", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const lifecycleState = await adminDb.customerLifecycleState.findFirstOrThrow({
      where: { organizationId: org.id },
    });

    await createCompany(ctx, {
      name: "Acme Ltd",
      ownerMembershipId: ctx.membershipId,
      lifecycleStateId: lifecycleState.id,
    });

    const csv = await exportService.exportCompaniesCsv(ctx);
    expect(csv.columns).toContain("name");
    const rows = await collectRows(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Acme Ltd",
      lifecycleState: lifecycleState.name,
    });
    expect(typeof rows[0]!.owner).toBe("string");
    expect(rows[0]!.owner).not.toBe("");

    const auditEvents = await adminDb.auditEvent.findMany({
      where: { organizationId: org.id, action: "companies.exported" },
    });
    expect(auditEvents).toHaveLength(1);
  });
});

describe("exportService: deals", () => {
  it("masks value for an exporter without deals.view.value who does not own the deal", async () => {
    const org = await createTestOrganization();
    const ownerCtx = await createTestContext(org.id, "MANAGEMENT", "owner");
    const exporterCtx = await createTestContext(org.id, "MANAGEMENT", "exporter");

    const { company } = await createCompany(ownerCtx, { name: "Deal Co" });
    const pipelineStageId = await getPipelineStageId(org.id);
    await createDeal(ownerCtx, {
      companyId: company.id,
      pipelineStageId,
      value: "5000",
    });

    // Simulate a hypothetical role that can export deals but not see
    // org-wide value figures -- not a real seeded role today (deals.export
    // is Management-only, which always also has deals.view.value), but the
    // masking rule must hold for any permission combination, not just the
    // ones currently assigned.
    const restrictedExporterCtx = {
      ...exporterCtx,
      permissionKeys: exporterCtx.permissionKeys.filter(
        (k) => k !== "deals.view.value",
      ),
    };

    const csv = await exportService.exportDealsCsv(restrictedExporterCtx);
    const rows = await collectRows(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.valueMasked).toBe(true);
    expect(rows[0]!.value).toBe("");
  });

  it("does not mask value for the deal's own owner", async () => {
    const org = await createTestOrganization();
    const ownerCtx = await createTestContext(org.id, "MANAGEMENT");

    const { company } = await createCompany(ownerCtx, { name: "Deal Co" });
    const pipelineStageId = await getPipelineStageId(org.id);
    await createDeal(ownerCtx, {
      companyId: company.id,
      pipelineStageId,
      value: "5000",
    });

    const csv = await exportService.exportDealsCsv(ownerCtx);
    const rows = await collectRows(csv);
    expect(rows[0]!.valueMasked).toBe(false);
    expect(rows[0]!.value).toBe("5000");
  });
});

describe("exportService: reports", () => {
  it("rejects export for a role without export.bulk", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "FINANCE");

    await expect(exportService.exportReportsCsv(ctx)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("produces a multi-section CSV for a role with export.bulk", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");

    const csv = await exportService.exportReportsCsv(ctx);
    expect(csv).toContain("Lead volume by source");
    expect(csv).toContain("Pipeline value by stage");
  });

  it("resolves lead-source, pipeline-stage, and service names instead of raw IDs (FIG-603)", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const pipelineStageId = await getPipelineStageId(org.id);
    const wonStageId = await getPipelineStageId(org.id, "CLOSED_WON");
    const serviceId = await getServiceId(org.id);
    const service = await adminDb.service.findUniqueOrThrow({ where: { id: serviceId } });
    const stage = await adminDb.pipelineStage.findUniqueOrThrow({ where: { id: pipelineStageId } });
    const leadSource = await adminDb.leadSource.findFirstOrThrow({ where: { organizationId: org.id } });
    const leadStatusId = await getLeadStatusId(org.id);

    await createLead(ctx, { leadStatusId, leadSourceId: leadSource.id });

    const { company } = await createCompany(ctx, { name: "Named Co" });
    // One deal left open (shows up in "Pipeline value by stage" by its
    // starting stage) and one moved to CLOSED_WON (shows up in "Sales by
    // service" by its service) -- a single deal can't exercise both
    // sections, since winning it moves it off the open-pipeline stage.
    await createDeal(ctx, { companyId: company.id, pipelineStageId, value: "1000" });
    const wonDeal = await createDeal(ctx, {
      companyId: company.id,
      pipelineStageId,
      serviceId,
      value: "2500",
    });
    await updateDeal(ctx, wonDeal.id, { pipelineStageId: wonStageId });

    const csv = await exportService.exportReportsCsv(ctx);
    expect(csv).toContain(leadSource.name);
    expect(csv).toContain(stage.name);
    expect(csv).toContain(service.name);
    expect(csv).not.toContain(pipelineStageId);
    expect(csv).not.toContain(serviceId);
    expect(csv).not.toContain(leadSource.id);
  });
});
