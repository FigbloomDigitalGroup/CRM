import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ForbiddenError } from "../src/auth/errors";
import { runDueJobs } from "../src/jobs/runner";
import "../src/jobs/definitions";
import { getRun, getRunDownload, startImport } from "../src/services/dataRunService";
import { getStorageDriver } from "../src/storage";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";
import { createCompanyRow } from "./helpers/stage3";

const csv = (rows: string[]) => Buffer.from(rows.join("\n") + "\n");
const finish = (organizationId: string) => runDueJobs({ organizationIds: [organizationId], types: ["data.import"], maxJobs: 10, budgetMs: 120_000 });
const MAPPING = { company: "Company", contactEmail: "Contact", value: "Value", stage: "Stage", ownerEmail: "Owner", service: "Service", expectedCloseDate: "Close", name: "Name", tags: "Tags" };

describe("deals import (FIG-800)", () => {
  it("imports good rows, sends bad ones to the error report with the reason, defaults nothing, and audits the import", async () => {
    const org = await createTestOrganization("DealsImport");
    const mgmt = await createTestContext(org.id, "MANAGEMENT", "di.mgmt");
    const sales = await createTestContext(org.id, "SALES", "di.sales");
    const salesEmail = (await adminDb.user.findUniqueOrThrow({ where: { id: sales.userId } })).email;
    const known = await createCompanyRow(org.id, { name: "Kamau Hardware Ltd" });
    const contact = await adminDb.contact.create({ data: { organizationId: org.id, firstName: "Amina", email: "amina@kamau.test", companyId: known.id } });

    const run = await startImport(mgmt, {
      entity: "DEAL",
      fileName: "deals.csv",
      csv: csv([
        "Name,Company,Contact,Value,Stage,Owner,Service,Close,Tags",
        `CCTV Westlands,Kamau Hardware Ltd,amina@kamau.test,"450,000",Negotiation,${salesEmail},CCTV,30/11/2026,hot;retail`,
        `Fleet tracking,Brand New Traders,,120000,Solution Presented,${salesEmail},Fleet / GPS,2026-12-15,`,
        `Bad stage,Another Co,,1000,Not A Stage,${salesEmail},,,`,
        "Bad owner,Third Co,,1000,Negotiation,ghost@nowhere.test,,,",
        `No company,,,1000,Negotiation,${salesEmail},,,`,
        `Bad date,Fourth Co,,1000,Negotiation,${salesEmail},,31/02/2026,`,
      ]),
      mapping: MAPPING,
      duplicateStrategy: "skip",
    });
    await finish(org.id);
    const done = await getRun(mgmt, run.id);
    expect(done).toMatchObject({ status: "COMPLETED_WITH_ERRORS", totalRows: 6, createdRows: 2, failedRows: 4 });

    const first = await adminDb.deal.findFirstOrThrow({ where: { organizationId: org.id, companyId: known.id }, include: { pipelineStage: true, service: true, tagLinks: { include: { tag: true } } } });
    expect(first).toMatchObject({ ownerMembershipId: sales.membershipId, primaryContactId: contact.id, currency: "KES" });
    expect(first.value?.toString()).toBe("450000");
    expect(first.pipelineStage.name).toBe("Negotiation");
    expect(first.service?.key).toBe("CCTV");
    expect(first.expectedCloseDate?.toISOString().slice(0, 10)).toBe("2026-11-30");
    expect(first.notes).toBe("Deal: CCTV Westlands");
    expect(first.tagLinks.map((l) => l.tag.name).sort()).toEqual(["hot", "retail"]);
    // A company that did not exist was created, owned by the importer.
    const created = await adminDb.company.findFirstOrThrow({ where: { organizationId: org.id, name: "Brand New Traders" } });
    expect(created.ownerMembershipId).toBe(mgmt.membershipId);
    expect(await adminDb.deal.count({ where: { organizationId: org.id, companyId: created.id } })).toBe(1);
    // The bad rows made nothing, not even their companies.
    for (const name of ["Another Co", "Third Co", "Fourth Co"]) expect(await adminDb.company.count({ where: { organizationId: org.id, name } }), name).toBe(0);
    expect(await adminDb.deal.count({ where: { organizationId: org.id } })).toBe(2);

    // The error report names each row and why.
    const { file } = await getRunDownload(mgmt, run.id, "errors");
    const report = (await getStorageDriver().getObject(file.storageKey, 10_000_000)).toString("utf8");
    const lines = report.trim().split("\n");
    expect(lines).toHaveLength(5);
    expect(report).toMatch(/4,failed,.*Not A Stage/);
    expect(report).toMatch(/5,failed,.*ghost@nowhere\.test/);
    expect(report).toMatch(/6,failed,.*company is required/);
    expect(report).toMatch(/7,failed,.*real date/);

    const audit = await adminDb.auditEvent.findFirstOrThrow({ where: { organizationId: org.id, action: "deals.imported" } });
    expect(audit).toMatchObject({ actorMembershipId: mgmt.membershipId });
    expect(audit.metadata).toMatchObject({ created: 2, failed: 4, totalRows: 6 });
  });

  it("skips a deal that already exists, creates it anyway when asked, and needs permission to create deals", async () => {
    const org = await createTestOrganization("DealsImportDup");
    const mgmt = await createTestContext(org.id, "MANAGEMENT", "di.mgmt");
    const delivery = await createTestContext(org.id, "DELIVERY", "di.delivery");
    const email = (await adminDb.user.findUniqueOrThrow({ where: { id: mgmt.userId } })).email;
    const file = csv(["Company,Value,Stage,Owner", `Dup Co,1000,Negotiation,${email}`]);
    const mapping = { company: "Company", value: "Value", stage: "Stage", ownerEmail: "Owner" };

    for (const [strategy, expected] of [["skip", 1], ["skip", 1], ["create", 2]] as const) {
      const run = await startImport(mgmt, { entity: "DEAL", fileName: "d.csv", csv: file, mapping, duplicateStrategy: strategy });
      await finish(org.id);
      expect((await getRun(mgmt, run.id)).status).toBe("COMPLETED");
      expect(await adminDb.deal.count({ where: { organizationId: org.id } })).toBe(expected);
    }
    await expect(startImport(delivery, { entity: "DEAL", fileName: "d.csv", csv: file, mapping, duplicateStrategy: "skip" })).rejects.toThrow(ForbiddenError);
  });

  it("never touches another organisation's companies or people", async () => {
    const a = await createTestOrganization("DealsImportA");
    const b = await createTestOrganization("DealsImportB");
    const mgmtA = await createTestContext(a.id, "MANAGEMENT", "di.a");
    const mgmtB = await createTestContext(b.id, "MANAGEMENT", "di.b");
    const bEmail = (await adminDb.user.findUniqueOrThrow({ where: { id: mgmtB.userId } })).email;
    await createCompanyRow(b.id, { name: "B Only Ltd" });
    const run = await startImport(mgmtA, {
      entity: "DEAL",
      fileName: "d.csv",
      csv: csv(["Company,Value,Stage,Owner", `B Only Ltd,1,Negotiation,${bEmail}`]),
      mapping: { company: "Company", value: "Value", stage: "Stage", ownerEmail: "Owner" },
      duplicateStrategy: "skip",
    });
    await finish(a.id);
    // B's member is not A's, so the row fails; and the company is created fresh in A, never linked to B's.
    expect(await getRun(mgmtA, run.id)).toMatchObject({ createdRows: 0, failedRows: 1 });
    expect(await adminDb.deal.count({ where: { organizationId: b.id } })).toBe(0);
    expect(await adminDb.company.count({ where: { organizationId: a.id, name: "B Only Ltd" } })).toBe(0);
  });
});
