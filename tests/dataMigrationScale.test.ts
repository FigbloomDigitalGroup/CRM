import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { runPass } from "../src/services/migrationEngine";
import {
  cancelMigration,
  createMigrationSession,
  deleteMigrationPreset,
  getMigrationErrorReport,
  getMigrationSession,
  getMigrationTemplate,
  listMigrationEntities,
  listMigrationIssues,
  listMigrationPresets,
  listMigrationSessions,
  rollbackMigration,
  saveMigrationPreset,
  setMigrationMapping,
  startMigrationDryRun,
  startMigrationImport,
  startMigrationValidation,
  uploadMigrationFile,
} from "../src/services/migrationService";
import { createTestContext, createTestOrganization, getPipelineStageId } from "./helpers/fixtures";
import { drain, csv, emailOf, prepare } from "./helpers/migration";

async function setup() {
  const org = await createTestOrganization("MigrationScale");
  const management = await createTestContext(org.id, "MANAGEMENT", "migs.mgmt");
  const sales = await createTestContext(org.id, "SALES", "migs.sales");
  return { org, management, sales, salesEmail: await emailOf(sales) };
}

describe("a row that cannot be saved costs one row (partial failure)", () => {
  it("imports the good rows, reports the bad one at its row with the reason, and the report holds the original values", async () => {
    const { org, management } = await setup();
    // All three rows are valid, but the database refuses the one called Bad (a trigger stands in for any constraint the
    // file's data can trip): the chunk is retried row by row and only that row is lost.
    const fn = `tmp_reject_bad_${org.slug.replace(/[^a-z0-9]/g, "_")}`;
    await adminDb.$executeRawUnsafe(`CREATE FUNCTION ${fn}() RETURNS trigger AS $$ BEGIN IF NEW.first_name = 'Bad' AND NEW.organization_id = '${org.id}' THEN RAISE EXCEPTION 'rejected by test'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await adminDb.$executeRawUnsafe(`CREATE TRIGGER ${fn} BEFORE INSERT ON contacts FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    const rows = [
      { name: "Fine One", email: "one@x.test" },
      { name: "Bad Row", email: "bad@x.test" },
      { name: "Fine Two", email: "two@x.test" },
    ];
    const drive = await prepare(management, { entity: "CONTACT" }, csv(rows));
    let done;
    try {
      done = await drive.run();
    } finally {
      await adminDb.$executeRawUnsafe(`DROP TRIGGER ${fn} ON contacts`);
      await adminDb.$executeRawUnsafe(`DROP FUNCTION ${fn}()`);
    }
    expect(done).toMatchObject({ status: "COMPLETED_WITH_ERRORS", counts: { created: 2, errors: 1, failed: 1 } });
    expect(await adminDb.contact.count({ where: { organizationId: org.id, firstName: { in: ["Fine", "Bad"] } } })).toBe(2);

    const issues = (await listMigrationIssues(management, drive.id, { phase: "IMPORT", severity: "ERROR" })).items;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ row: 3 });
    expect(issues[0]!.message).toMatch(/Could not be saved/);
    const report = (await getMigrationErrorReport(management, drive.id, "IMPORT")).toString("utf8");
    expect(report).toContain("bad@x.test");
    // Nothing half-made is left behind, and the rollback knows exactly the two it made.
    expect(await adminDb.importSessionChange.count({ where: { sessionId: drive.id, action: "CREATED" } })).toBe(2);
  });
});

describe("rollback (FIG-1061)", () => {
  async function imported() {
    const ctx = await setup();
    const rows = Array.from({ length: 6 }, (_, i) => ({ name: `Rollback Co ${i + 1}`, industry: "Imported" }));
    const drive = await prepare(ctx.management, { entity: "COMPANY" }, csv(rows));
    await drive.run();
    return { ...ctx, drive };
  }

  it("removes everything the session created and nothing else, and says so in the audit trail", async () => {
    const { org, management, drive } = await imported();
    const mine = await adminDb.company.create({ data: { organizationId: org.id, name: "Not From The Import" } });
    const before = await getMigrationSession(management, drive.id);
    expect(before.rollback.canRollback).toBe(true);
    expect(await adminDb.company.count({ where: { organizationId: org.id, importSessionId: drive.id } })).toBe(6);

    await rollbackMigration(management, drive.id);
    await drain(org.id);
    const after = await getMigrationSession(management, drive.id);
    expect(after.status).toBe("ROLLED_BACK");
    expect(after.rollback).toMatchObject({ canRollback: false, result: { deleted: 6, kept: 0 } });
    expect(await adminDb.company.count({ where: { organizationId: org.id, importSessionId: drive.id } })).toBe(0);
    expect(await adminDb.company.findUnique({ where: { id: mine.id } })).not.toBeNull();
    const audit = await adminDb.auditEvent.findFirstOrThrow({ where: { organizationId: org.id, action: "data_migration.rolled_back" } });
    expect(audit).toMatchObject({ actorMembershipId: management.membershipId, entityId: drive.id });
    expect(audit.metadata).toMatchObject({ deleted: 6 });
    // Once is enough.
    await expect(rollbackMigration(management, drive.id)).rejects.toThrow(/already rolled back/);
  });

  it("keeps what people did afterwards: an edited record, one that now has a deal, and says why", async () => {
    const { org, management, sales, drive } = await imported();
    const companies = await adminDb.company.findMany({ where: { organizationId: org.id, importSessionId: drive.id }, orderBy: { name: "asc" } });
    // Edited after the import.
    await new Promise((r) => setTimeout(r, 1200));
    await adminDb.company.update({ where: { id: companies[0]!.id }, data: { notes: "Someone added notes" } });
    // A deal added to another one.
    await adminDb.deal.create({ data: { organizationId: org.id, companyId: companies[1]!.id, pipelineStageId: await getPipelineStageId(org.id), ownerMembershipId: sales.membershipId } });

    await rollbackMigration(management, drive.id);
    await drain(org.id);
    const after = await getMigrationSession(management, drive.id);
    expect(after.status).toBe("ROLLED_BACK");
    expect(after.rollback.result).toMatchObject({ deleted: 4, kept: 2 });
    const reasons = (after.rollback.result as { keptReasons: Record<string, number> }).keptReasons;
    expect(Object.keys(reasons).sort()).toEqual(["changed after the import", "it has deals that were not imported"]);
    const left = await adminDb.company.findMany({ where: { organizationId: org.id, importSessionId: drive.id }, orderBy: { name: "asc" } });
    expect(left.map((c) => c.id).sort()).toEqual([companies[0]!.id, companies[1]!.id].sort());
  });

  it("puts back the fields an UPDATE changed, unless someone changed them again", async () => {
    const { org, management } = await setup();
    const a = await adminDb.company.create({ data: { organizationId: org.id, name: "Restore A", industry: "Old A" } });
    const b = await adminDb.company.create({ data: { organizationId: org.id, name: "Restore B", industry: "Old B" } });
    const drive = await prepare(management, { entity: "COMPANY", duplicatePolicy: "UPDATE" }, csv([{ name: "Restore A", industry: "New A" }, { name: "Restore B", industry: "New B" }]), { duplicatePolicy: "UPDATE" });
    const done = await drive.run();
    expect(done.counts).toMatchObject({ updated: 2, created: 0 });
    await adminDb.company.update({ where: { id: b.id }, data: { industry: "Edited since" } });

    await rollbackMigration(management, drive.id);
    await drain(org.id);
    expect((await adminDb.company.findUniqueOrThrow({ where: { id: a.id } })).industry).toBe("Old A");
    expect((await adminDb.company.findUniqueOrThrow({ where: { id: b.id } })).industry).toBe("Edited since");
    expect(((await getMigrationSession(management, drive.id)).rollback.result as { restored: number; kept: number })).toMatchObject({ restored: 1, kept: 1 });
  });

  it("is refused when there is nothing to undo, while it is running, after the window, or for anyone but Management", async () => {
    const { org, management, sales, drive } = await imported();
    await expect(rollbackMigration(sales, drive.id)).rejects.toThrow(ForbiddenError);

    const empty = await createMigrationSession(management, { entity: "COMPANY" });
    await expect(rollbackMigration(management, empty.id)).rejects.toThrow(/nothing to roll back/);

    await adminDb.importSession.update({ where: { id: drive.id }, data: { rollbackDeadline: new Date(Date.now() - 1000) } });
    const late = await getMigrationSession(management, drive.id);
    expect(late.rollback.canRollback).toBe(false);
    const err = await rollbackMigration(management, drive.id).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.issues[0].code).toBe("ROLLBACK_WINDOW_PASSED");

    await adminDb.importSession.update({ where: { id: drive.id }, data: { rollbackDeadline: new Date(Date.now() + 3_600_000), status: "IMPORTING" } });
    await expect(rollbackMigration(management, drive.id)).rejects.toThrow(/already running/);
    void org;
  });
});

describe("cancelling", () => {
  it("a waiting migration is cancelled at once; a running one stops at the next chunk, keeps what it wrote, and can be rolled back", async () => {
    const { org, management } = await setup();
    // Waiting: cancelled before it starts.
    const waiting = await prepare(management, { entity: "COMPANY" }, csv([{ name: "Waiting Co" }]));
    await startMigrationImport(management, waiting.id, { confirm: true });
    expect((await cancelMigration(management, waiting.id)).status).toBe("CANCELLED");
    await drain(org.id);
    expect((await getMigrationSession(management, waiting.id)).status).toBe("CANCELLED");
    expect(await adminDb.company.count({ where: { organizationId: org.id } })).toBe(0);

    // Running: 1,000 rows is five chunks of 200.
    const rows = Array.from({ length: 1000 }, (_, i) => ({ name: `Cancel Co ${i}` }));
    const drive = await prepare(management, { entity: "COMPANY" }, csv(rows));
    await startMigrationImport(management, drive.id, { confirm: true });
    const job = drain(org.id);
    for (let i = 0; i < 400; i += 1) {
      const s = await adminDb.importSession.findUniqueOrThrow({ where: { id: drive.id } });
      if (s.status === "IMPORTING" && s.createdRows > 0) break;
      await new Promise((r) => setTimeout(r, 15));
    }
    await cancelMigration(management, drive.id);
    await job;
    await drain(org.id);
    const stopped = await getMigrationSession(management, drive.id);
    expect(stopped.status).toBe("CANCELLED");
    expect(stopped.counts.created).toBeGreaterThan(0);
    expect(stopped.counts.created).toBeLessThan(1000);
    expect(stopped.counts.created % 200).toBe(0);
    expect(await adminDb.company.count({ where: { organizationId: org.id, importSessionId: drive.id } })).toBe(stopped.counts.created);
    expect(stopped.rollback.canRollback).toBe(true);

    await rollbackMigration(management, drive.id);
    await drain(org.id);
    expect(await adminDb.company.count({ where: { organizationId: org.id } })).toBe(0);
    expect((await getMigrationSession(management, drive.id)).status).toBe("ROLLED_BACK");
  }, 120_000);
});

describe("10,000 rows (FIG-1061 acceptance)", () => {
  it("a mixed file (good rows, bad rows, repeats and rows matching existing records) completes with tags, can be listed page by page, and rolls back cleanly", async () => {
    const { org, management, salesEmail } = await setup();
    const existing = Array.from({ length: 300 }, (_, i) => ({ organizationId: org.id, name: `Existing ${i} Ltd`, email: `existing${i}@old.test` }));
    await adminDb.company.createMany({ data: existing });

    const rows: Record<string, string>[] = [];
    for (let i = 0; i < 10_000; i += 1) {
      if (i % 50 === 0) rows.push({ name: `Bad Email ${i}`, email: "not-an-email", owner: salesEmail, tags: "bulk", created: "" }); // 200 bad
      else if (i % 40 === 1) rows.push({ name: `Existing ${(i / 40) | 0} Ltd`, email: "", owner: "", tags: "", created: "" }); // matches existing (250 distinct, some repeat)
      else if (i % 33 === 2) rows.push({ name: `Repeated ${i % 7} Ltd`, email: "", owner: "", tags: "", created: "" }); // repeats inside the file
      else rows.push({ name: `Bulk Company ${i}`, email: `bulk${i}@example.test`, owner: i % 2 ? salesEmail : "", tags: i % 3 ? "bulk;wave-1" : "bulk", created: "2025-03-14" });
    }
    const started = Date.now();
    const drive = await prepare(management, { entity: "COMPANY" }, csv(rows));
    const prepared = Date.now() - started;
    const dry = (await drive.get()).dryRun as { wouldCreate: number; wouldSkip: number; errors: number; newTags: number; totalRows: number };
    expect(dry.totalRows).toBe(10_000);
    expect(dry.errors).toBe(200);
    expect(dry.wouldCreate + dry.wouldSkip + dry.errors).toBe(10_000);
    expect(dry.newTags).toBe(2);

    const importStarted = Date.now();
    const done = await drive.run();
    const importMs = Date.now() - importStarted;
    expect(done.status).toBe("COMPLETED_WITH_ERRORS");
    expect(done.counts).toMatchObject({ total: 10_000, created: dry.wouldCreate, skipped: dry.wouldSkip, errors: 200 });
    expect(await adminDb.company.count({ where: { organizationId: org.id, importSessionId: drive.id } })).toBe(dry.wouldCreate);
    expect(await adminDb.company.count({ where: { organizationId: org.id } })).toBe(300 + dry.wouldCreate);
    expect(await adminDb.tag.count({ where: { organizationId: org.id, name: { in: ["bulk", "wave-1"] } } })).toBe(2);
    expect(await adminDb.tagLink.count({ where: { organizationId: org.id, companyId: { not: null } } })).toBeGreaterThan(5000);
    expect((await adminDb.company.findFirstOrThrow({ where: { organizationId: org.id, name: "Bulk Company 3" } })).createdAt.toISOString().slice(0, 10)).toBe("2025-03-14");

    // The error list pages, and the report covers every bad row.
    const page = await listMigrationIssues(management, drive.id, { phase: "IMPORT", severity: "ERROR", paging: { pageSize: 50 } });
    expect(page.total).toBe(200);
    expect(page.items).toHaveLength(50);
    const report = (await getMigrationErrorReport(management, drive.id, "IMPORT")).toString("utf8").trim().split("\n");
    expect(report.length).toBeGreaterThan(200);

    const rollbackStarted = Date.now();
    await rollbackMigration(management, drive.id);
    await drain(org.id);
    const rollbackMs = Date.now() - rollbackStarted;
    const after = await getMigrationSession(management, drive.id);
    expect(after.status).toBe("ROLLED_BACK");
    expect(after.rollback.result).toMatchObject({ deleted: dry.wouldCreate, kept: 0 });
    expect(await adminDb.company.count({ where: { organizationId: org.id } })).toBe(300);
    expect(await adminDb.tagLink.count({ where: { organizationId: org.id } })).toBe(0);
    // The numbers, for the record.
    console.log(`10,000-row migration: validate and dry run ${prepared} ms, import ${importMs} ms, rollback ${rollbackMs} ms`);
    expect(importMs).toBeLessThan(120_000);
  }, 600_000);

  it("a thousand deals create their companies and are rolled back, deals first", async () => {
    const { org, management, salesEmail } = await setup();
    const rows = Array.from({ length: 1000 }, (_, i) => ({ company: `Deal Company ${i % 400}`, stage: i % 5 ? "Negotiation" : "Closed Won", owner: salesEmail, value: String(1000 + i), closedate: "2026-11-30" }));
    const drive = await prepare(management, { entity: "DEAL" }, csv(rows));
    const done = await drive.run();
    expect(done.counts).toMatchObject({ created: 1000, errors: 0 });
    expect(await adminDb.company.count({ where: { organizationId: org.id, importSessionId: drive.id } })).toBe(400);
    expect(await adminDb.deal.count({ where: { organizationId: org.id, importSessionId: drive.id } })).toBe(1000);

    await rollbackMigration(management, drive.id);
    await drain(org.id);
    const after = await getMigrationSession(management, drive.id);
    expect(after.rollback.result).toMatchObject({ deleted: 1400, kept: 0 });
    expect(await adminDb.deal.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await adminDb.company.count({ where: { organizationId: org.id } })).toBe(0);
  }, 300_000);
});

describe("no cross-organisation reads or writes under any mapping", () => {
  it("rows cannot refer to another organisation's companies, people, statuses or contacts, and sessions are invisible across organisations", async () => {
    const a = await setup();
    const b = await setup();
    await adminDb.company.create({ data: { organizationId: b.org.id, name: "Only In Org B Ltd", email: "owner@b.test" } });
    await adminDb.contact.create({ data: { organizationId: b.org.id, firstName: "Bee", email: "bee@b.test" } });
    await adminDb.leadStatus.create({ data: { organizationId: b.org.id, key: "B_ONLY", name: "Only In B", sequence: 99 } });

    // Org A's file names B's company, B's member, B's contact and B's status.
    const bOwner = await emailOf(b.sales);
    const contacts = await prepare(a.management, { entity: "CONTACT" }, csv([{ name: "Cross Test", email: "x@a.test", company: "Only In Org B Ltd", owner: bOwner }]));
    const contactDry = (await contacts.get()).dryRun as { wouldCreate: number; errors: number };
    expect(contactDry).toMatchObject({ wouldCreate: 0, errors: 1 });
    const problems = (await listMigrationIssues(a.management, contacts.id, { severity: "ERROR" })).items.map((i) => i.field).sort();
    expect(problems).toEqual(["company", "ownerEmail"]);

    const leads = await prepare(a.management, { entity: "LEAD" }, csv([{ name: "Bee Again", email: "bee@b.test", status: "Only In B" }]));
    expect((await leads.get()).dryRun).toMatchObject({ errors: 1 });
    // B's contact is not a duplicate of A's, because A cannot see it: the lead would have created its own contact if the status had been valid.
    const leadsFixed = await prepare(a.management, { entity: "LEAD" }, csv([{ name: "Bee Again", email: "bee@b.test", status: "" }]));
    const fixedDry = (await leadsFixed.get()).dryRun as { wouldCreate: number; newContacts: number };
    expect(fixedDry).toMatchObject({ wouldCreate: 1, newContacts: 1 });
    await leadsFixed.run();
    expect(await adminDb.contact.count({ where: { organizationId: b.org.id } })).toBe(1);

    // Another organisation's manager cannot read, list, cancel or roll back A's sessions.
    await expect(getMigrationSession(b.management, contacts.id)).rejects.toThrow(NotFoundError);
    await expect(listMigrationIssues(b.management, contacts.id)).rejects.toThrow(NotFoundError);
    await expect(cancelMigration(b.management, contacts.id)).rejects.toThrow(NotFoundError);
    await expect(rollbackMigration(b.management, leadsFixed.id)).rejects.toThrow(NotFoundError);
    await expect(uploadMigrationFile(b.management, contacts.id, { fileName: "x.csv", data: csv([{ a: "1" }]) })).rejects.toThrow(NotFoundError);
    await expect(setMigrationMapping(b.management, contacts.id, { mapping: {} })).rejects.toThrow(NotFoundError);
    expect((await listMigrationSessions(b.management)).items).toHaveLength(0);

    // A job that names another organisation's session does nothing to it.
    await runPass(b.org.id, contacts.id, "VALIDATE");
    expect((await adminDb.importSession.findUniqueOrThrow({ where: { id: contacts.id } })).status).toBe("DRY_RUN_DONE");
  });

  it("every migration table is protected by row-level security", async () => {
    const a = await setup();
    const b = await setup();
    const drive = await prepare(a.management, { entity: "COMPANY" }, csv([{ name: "RLS Co", email: "bad" }, { name: "RLS Two" }]));
    await drive.run();
    await saveMigrationPreset(a.management, { name: "RLS preset", entity: "COMPANY", mapping: { name: "name" } });
    const seen = await withOrgContext(b.org.id, async (tx) => ({
      sessions: await tx.importSession.count(),
      presets: await tx.importMappingPreset.count(),
      issues: await tx.importSessionIssue.count(),
      changes: await tx.importSessionChange.count(),
    }));
    expect(seen).toEqual({ sessions: 0, presets: 0, issues: 0, changes: 0 });
    const own = await withOrgContext(a.org.id, async (tx) => ({ sessions: await tx.importSession.count(), changes: await tx.importSessionChange.count() }));
    expect(own.sessions).toBeGreaterThan(0);
    expect(own.changes).toBeGreaterThan(0);
    await expect(
      withOrgContext(b.org.id, (tx) => tx.importSession.create({ data: { organizationId: a.org.id, entity: "COMPANY", updatedAt: new Date() } as never })),
    ).rejects.toThrow();
    await expect(deleteMigrationPreset(b.management, (await listMigrationPresets(a.management)).items[0]!.id)).rejects.toThrow(NotFoundError);
  });
});

describe("only Management", () => {
  it("everything is refused to Sales, Delivery and Finance", async () => {
    const { org, management } = await setup();
    const drive = await prepare(management, { entity: "COMPANY" }, csv([{ name: "Perm Co" }]));
    for (const role of ["SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL"] as const) {
      const ctx = await createTestContext(org.id, role, `migs.${role}`);
      const attempts: Promise<unknown>[] = [
        listMigrationEntities(ctx),
        createMigrationSession(ctx, { entity: "COMPANY" }),
        getMigrationSession(ctx, drive.id),
        listMigrationSessions(ctx),
        uploadMigrationFile(ctx, drive.id, { fileName: "x.csv", data: csv([{ a: "1" }]) }),
        setMigrationMapping(ctx, drive.id, { mapping: {} }),
        startMigrationValidation(ctx, drive.id),
        startMigrationDryRun(ctx, drive.id),
        startMigrationImport(ctx, drive.id, { confirm: true }),
        cancelMigration(ctx, drive.id),
        rollbackMigration(ctx, drive.id),
        listMigrationIssues(ctx, drive.id),
        getMigrationErrorReport(ctx, drive.id),
        listMigrationPresets(ctx),
        saveMigrationPreset(ctx, { name: "x", entity: "COMPANY", mapping: {} }),
      ];
      for (const attempt of attempts) await expect(attempt, role).rejects.toThrow(ForbiddenError);
      expect(() => getMigrationTemplate(ctx, "COMPANY")).toThrow(ForbiddenError);
    }
  });
});

describe("audit", () => {
  it("records the start, the import with its counts and who did it, and a cancellation", async () => {
    const { org, management } = await setup();
    const drive = await prepare(management, { entity: "COMPANY" }, csv([{ name: "Audit Co" }]));
    await drive.run();
    const second = await prepare(management, { entity: "COMPANY" }, csv([{ name: "Audit Two" }]));
    await startMigrationImport(management, second.id, { confirm: true });
    await cancelMigration(management, second.id);
    const actions = (await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: { startsWith: "data_migration." } }, orderBy: { createdAt: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(["data_migration.started", "data_migration.imported", "data_migration.started", "data_migration.cancelled"]);
    const imported = await adminDb.auditEvent.findFirstOrThrow({ where: { organizationId: org.id, action: "data_migration.imported" } });
    expect(imported.actorMembershipId).toBe(management.membershipId);
    expect(imported.metadata).toMatchObject({ rows: 1, created: 1, status: "COMPLETED" });
  });
});
