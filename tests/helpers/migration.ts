import { stringify } from "csv-stringify/sync";
import type { AuthContext } from "../../src/auth/context";
import { adminDb } from "../../src/db/adminClient";
import { runDueJobs } from "../../src/jobs/runner";
import { MIGRATION_JOB } from "../../src/services/migrationConstants";
import {
  createMigrationSession,
  getMigrationSession,
  setMigrationMapping,
  startMigrationDryRun,
  startMigrationImport,
  startMigrationValidation,
  uploadMigrationFile,
  type CreateSessionInput,
  type MappingInput,
} from "../../src/services/migrationService";

/** Helpers for the data migration tests (FIG-1061): build a CSV, drive a session through the steps, run its jobs. */

export const csv = (rows: Record<string, unknown>[], columns?: string[]): Buffer =>
  Buffer.from(stringify(rows, { header: true, columns: columns ?? Object.keys(rows[0] ?? {}) }));

export async function emailOf(ctx: AuthContext): Promise<string> {
  return (await adminDb.user.findUniqueOrThrow({ where: { id: ctx.userId } })).email;
}

/**
 * Runs the queued migration jobs for an organisation to the end. A job is due from the moment the application clock says so, which
 * can be a few milliseconds ahead of the database's, so keep asking until nothing is queued or running.
 */
export async function drain(organizationId: string): Promise<void> {
  // A test that timed out mid-job leaves a RUNNING row whose lease lasts an hour; the per-type concurrency limit counts it, so clear those first.
  await adminDb.backgroundJob.updateMany({ where: { type: MIGRATION_JOB, status: "RUNNING", startedAt: { lt: new Date(Date.now() - 3 * 60_000) } }, data: { status: "DEAD", lastError: "left running by an aborted test" } });
  for (let i = 0; i < 200; i += 1) {
    await runDueJobs({ types: [MIGRATION_JOB], organizationIds: [organizationId], budgetMs: 10 * 60_000 });
    const open = await adminDb.backgroundJob.count({ where: { organizationId, type: MIGRATION_JOB, status: { in: ["QUEUED", "RUNNING"] } } });
    if (open === 0) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("The migration job did not finish.");
}

export interface Drive {
  ctx: AuthContext;
  id: string;
  upload(fileName: string, data: Buffer): ReturnType<typeof uploadMigrationFile>;
  map(input: MappingInput): ReturnType<typeof setMigrationMapping>;
  validate(): Promise<Awaited<ReturnType<typeof getMigrationSession>>>;
  dryRun(): Promise<Awaited<ReturnType<typeof getMigrationSession>>>;
  run(): Promise<Awaited<ReturnType<typeof getMigrationSession>>>;
  get(): ReturnType<typeof getMigrationSession>;
}

export async function startSession(ctx: AuthContext, input: CreateSessionInput): Promise<Drive> {
  const created = await createMigrationSession(ctx, input);
  const id = created.id;
  return {
    ctx,
    id,
    upload: (fileName, data) => uploadMigrationFile(ctx, id, { fileName, data }),
    map: (m) => setMigrationMapping(ctx, id, m),
    async validate() {
      await startMigrationValidation(ctx, id);
      await drain(ctx.organizationId);
      return getMigrationSession(ctx, id);
    },
    async dryRun() {
      await startMigrationDryRun(ctx, id);
      await drain(ctx.organizationId);
      return getMigrationSession(ctx, id);
    },
    async run() {
      await startMigrationImport(ctx, id, { confirm: true });
      await drain(ctx.organizationId);
      return getMigrationSession(ctx, id);
    },
    get: () => getMigrationSession(ctx, id),
  };
}

/** Upload, accept the suggested mapping (plus overrides), validate, dry run: ready to import. */
export async function prepare(ctx: AuthContext, input: CreateSessionInput, data: Buffer, mapping: MappingInput = {}): Promise<Drive> {
  const drive = await startSession(ctx, input);
  const uploaded = await drive.upload("migration.csv", data);
  await drive.map({ mapping: uploaded.session.mapping as Record<string, string>, ...mapping });
  await drive.validate();
  await drive.dryRun();
  return drive;
}
