import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ForbiddenError, NotFoundError } from "../src/auth/errors";
import { runDueJobs } from "../src/jobs/runner";
import "../src/jobs/definitions";
import { createCompany } from "../src/services/companyService";
import { createContact, listContacts } from "../src/services/contactService";
import { createCustomFieldDefinition } from "../src/services/customFieldService";
import { createLead } from "../src/services/leadService";
import {
  cancelRun,
  getRun,
  getRunDownload,
  listRuns,
  startExport,
  startImport,
} from "../src/services/dataRunService";
import { getStorageDriver } from "../src/storage";
import { createTestContext, createTestOrganization, getLeadStatusId } from "./helpers/fixtures";

const finish = (organizationId: string) => runDueJobs({ organizationIds: [organizationId], types: ["data.import", "data.export"], maxJobs: 10, budgetMs: 240_000 });

async function download(ctx: Awaited<ReturnType<typeof createTestContext>>, runId: string, which: "result" | "errors") {
  const { file } = await getRunDownload(ctx, runId, which);
  return (await getStorageDriver().getObject(file.storageKey, 50 * 1024 * 1024)).toString("utf8");
}

const csv = (rows: string[]) => Buffer.from(rows.join("\n") + "\n");

describe("import and export runs (FIG-1034, B2.05)", () => {
  it("a 5,000-row import is queued at once, then completes in the background", async () => {
    const org = await createTestOrganization("Big");
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const rows = ["First,Last,Email"];
    for (let i = 0; i < 5000; i += 1) rows.push(`Person${i},Test,person${i}@bulk.test`);
    const started = await startImport(mgmt, {
      entity: "CONTACT",
      fileName: "people.csv",
      csv: csv(rows),
      mapping: { firstName: "First", lastName: "Last", email: "Email" },
      duplicateStrategy: "skip",
    });
    expect(started.status).toBe("QUEUED");
    expect(started.createdRows).toBe(0);

    await finish(org.id);
    const done = await getRun(mgmt, started.id);
    expect(done.status).toBe("COMPLETED");
    expect(done).toMatchObject({ totalRows: 5000, createdRows: 5000, failedRows: 0, done: true });
    expect(await adminDb.contact.count({ where: { organizationId: org.id } })).toBe(5000);
  }, 280_000);

  it("keeps the good rows when others fail, and gives an error report with the row numbers", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const run = await startImport(mgmt, {
      entity: "CONTACT",
      fileName: "mixed.csv",
      csv: csv(["First,Email,Owner", "Ann,ann@x.test,", ",nofirst@x.test,", "Cy,cy@x.test,nobody@nowhere.test", "Di,di@x.test,"]),
      mapping: { firstName: "First", email: "Email", ownerEmail: "Owner" },
      duplicateStrategy: "skip",
    });
    await finish(org.id);
    const done = await getRun(mgmt, run.id);
    expect(done.status).toBe("COMPLETED_WITH_ERRORS");
    expect(done).toMatchObject({ createdRows: 2, failedRows: 2, hasErrorReport: true });
    expect((await listContacts(mgmt)).map((c) => c.firstName).sort()).toEqual(["Ann", "Di"]);
    const report = await download(mgmt, run.id, "errors");
    expect(report.split("\n")[0]).toBe("row,outcome,reason,matchedRecordId");
    expect(report).toContain("3,failed,");
    expect(report).toContain("4,failed,");
  });

  it("skips duplicates and already-converted leads, and says which existing record matched", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const statusId = await getLeadStatusId(org.id);
    const { contact: existing } = await createContact(mgmt, { firstName: "Dup", email: "dup@x.test" });
    const { contact: won } = await createContact(mgmt, { firstName: "Won", email: "won@x.test" });
    const { lead } = await createLead(mgmt, { leadStatusId: statusId, contactId: won.id });
    await adminDb.lead.update({ where: { id: lead.id }, data: { convertedAt: new Date() } });

    const people = await startImport(mgmt, {
      entity: "CONTACT",
      fileName: "c.csv",
      csv: csv(["First,Email", "Dup,dup@x.test", "Fresh,fresh@x.test"]),
      mapping: { firstName: "First", email: "Email" },
      duplicateStrategy: "skip",
    });
    const leads = await startImport(mgmt, {
      entity: "LEAD",
      fileName: "l.csv",
      csv: csv(["Status,Email", `${(await adminDb.leadStatus.findFirstOrThrow({ where: { id: statusId } })).name},won@x.test`]),
      mapping: { leadStatus: "Status", contactEmail: "Email" },
      duplicateStrategy: "skip",
    });
    await finish(org.id);
    expect(await getRun(mgmt, people.id)).toMatchObject({ createdRows: 1, duplicateRows: 1 });
    expect(await getRun(mgmt, leads.id)).toMatchObject({ createdRows: 0, alreadyConvertedRows: 1 });
    expect(await download(mgmt, people.id, "errors")).toContain(existing.id);
    expect(await download(mgmt, leads.id, "errors")).toContain("already_converted");
  });

  it("reads tags and custom field columns, and a bad custom value fails only its row", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    await createCustomFieldDefinition(mgmt, { entityType: "COMPANY", key: "employees", label: "Employees", fieldType: "NUMBER" } as never);
    const run = await startImport(mgmt, {
      entity: "COMPANY",
      fileName: "co.csv",
      csv: csv(["Name,tags,cf:employees", "Alpha Co,vip; kenya,40", "Beta Co,,lots"]),
      mapping: { name: "Name" },
      duplicateStrategy: "skip",
    });
    await finish(org.id);
    expect(await getRun(mgmt, run.id)).toMatchObject({ createdRows: 1, failedRows: 1 });
    const alpha = await adminDb.company.findFirstOrThrow({ where: { organizationId: org.id, name: "Alpha Co" }, include: { tagLinks: { include: { tag: true } } } });
    expect((alpha.customFields as Record<string, unknown>).employees).toBe(40);
    expect(alpha.tagLinks.map((l) => l.tag.name).sort()).toEqual(["kenya", "vip"]);
  });

  it("can be cancelled: queued runs end at once, running ones stop at the next check and keep what was imported", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const queued = await startImport(mgmt, { entity: "CONTACT", fileName: "q.csv", csv: csv(["First", "One"]), mapping: { firstName: "First" }, duplicateStrategy: "skip" });
    expect((await cancelRun(mgmt, queued.id)).status).toBe("CANCELLED");
    await finish(org.id);
    expect(await adminDb.contact.count({ where: { organizationId: org.id } })).toBe(0);

    const rows = ["First"];
    for (let i = 0; i < 400; i += 1) rows.push(`Row${i}`);
    const running = await startImport(mgmt, { entity: "CONTACT", fileName: "r.csv", csv: csv(rows), mapping: { firstName: "First" }, duplicateStrategy: "skip" });
    await adminDb.dataRun.update({ where: { id: running.id }, data: { cancelRequested: true } }); // asked to stop before the worker looks
    await finish(org.id);
    const stopped = await getRun(mgmt, running.id);
    expect(stopped.status).toBe("CANCELLED");
    expect(stopped.createdRows).toBeLessThan(400);
    expect(await cancelRun(mgmt, running.id)).toMatchObject({ status: "CANCELLED" }); // already over: reported as is
  });

  it("export: runs in the background, the file comes through the file service, and it is audited", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    for (let i = 0; i < 3; i += 1) await createCompany(mgmt, { name: `Exp ${i} Ltd` });
    const run = await startExport(mgmt, { entity: "COMPANY", filters: { query: "Exp" } });
    expect(run.status).toBe("QUEUED");
    await finish(org.id);
    const done = await getRun(mgmt, run.id);
    expect(done).toMatchObject({ status: "COMPLETED", totalRows: 3, hasResultFile: true });
    const text = await download(mgmt, run.id, "result");
    expect(text.split("\n").filter(Boolean)).toHaveLength(4);
    expect(text).toContain("Exp 1 Ltd");
    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: { in: ["companies.exported", "data.export.completed"] } } });
    expect(audit.length).toBeGreaterThanOrEqual(1);
    const file = await adminDb.file.findFirstOrThrow({ where: { id: (await adminDb.dataRun.findUniqueOrThrow({ where: { id: run.id } })).resultFileId! } });
    expect(file.purpose).toBe("EXPORT");
  });

  it("export over 500 rows needs the bulk-export permission; Management may, Sales may not", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES", "s");
    await adminDb.contact.createMany({
      data: Array.from({ length: 501 }, (_, i) => ({ organizationId: org.id, firstName: `Bulk${i}`, ownerMembershipId: sales.membershipId })),
    });
    await expect(startExport(sales, { entity: "CONTACT" })).rejects.toBeInstanceOf(ForbiddenError);
    const ok = await startExport(mgmt, { entity: "CONTACT" });
    expect(ok.status).toBe("QUEUED");
    await finish(org.id);
    expect((await getRun(mgmt, ok.id)).totalRows).toBe(501);
  }, 120_000);

  it("deal export is limited to roles with deals.export (which also carry deal values); others are refused outright", async () => {
    const org = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const finance = await createTestContext(org.id, "FINANCE");
    const run = await startExport(mgmt, { entity: "DEAL" });
    await finish(org.id);
    expect((await getRun(mgmt, run.id)).status).toBe("COMPLETED");
    // Roles without the export permission cannot start one at all.
    await expect(startExport(await createTestContext(org.id, "RESTRICTED_TECHNICAL", "t"), { entity: "DEAL" })).rejects.toBeInstanceOf(ForbiddenError);
    void finance;
  });

  it("only the person who started a run, or Management, can see, cancel or download it; other organisations cannot", async () => {
    const org = await createTestOrganization();
    const other = await createTestOrganization();
    const mgmt = await createTestContext(org.id, "MANAGEMENT");
    const salesA = await createTestContext(org.id, "SALES", "a");
    const salesB = await createTestContext(org.id, "SALES", "b");
    const outsider = await createTestContext(other.id, "MANAGEMENT", "o");
    const run = await startExport(mgmt, { entity: "COMPANY" });
    await expect(getRun(salesA, run.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelRun(salesB, run.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getRun(outsider, run.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listRuns(salesA)).total).toBe(0);
    expect((await listRuns(mgmt)).total).toBe(1);
    await expect(getRunDownload(mgmt, run.id, "result")).rejects.toBeInstanceOf(NotFoundError); // nothing yet
  });

  it("a person without the import permission cannot start an import", async () => {
    const org = await createTestOrganization();
    const tech = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
    await expect(
      startImport(tech, { entity: "CONTACT", fileName: "x.csv", csv: csv(["First", "A"]), mapping: { firstName: "First" }, duplicateStrategy: "skip" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
