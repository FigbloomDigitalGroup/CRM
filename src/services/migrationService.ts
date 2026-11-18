import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { Prisma, type ImportSession } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError, ValidationError, type ValidationIssue } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { enqueueJobFor } from "../jobs/runner";
import { type FieldDef, FIELDS, MIGRATION_ENTITIES, type MigrationEntity, suggestMapping, templateCsv } from "../lib/migrationFields";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import { recordAuditEvent } from "../repositories/auditEvents";
import { storeGeneratedFile } from "./fileService";
import { assertCsvRequestSize } from "./importService";
import { isXlsx, xlsxToCsv } from "../lib/spreadsheet";
import { MIGRATION_JOB } from "./migrationConstants";
import { type Phase, buildErrorReport, rollbackWindowMs, runPass, runRollback } from "./migrationEngine";

/**
 * Data migration, the engine behind Settings > Data migration (FIG-1061, B4.04, screen S7, questionnaire Q28).
 *
 * Seven steps: choose the source, upload, map the fields, validate, dry run, import, review. A session is one file for one kind of
 * record (companies, contacts, leads, deals, tasks or activities). Validation reads every row and reports per-row errors and warnings;
 * the dry run decides what the import would create, update and skip and shows a sample, writing nothing; the import runs as a
 * background job; every row it creates carries the session id; and the whole session can be rolled back within a window.
 * Management only (`configuration.manage`): this is also how the production data first gets in (P1.05).
 *
 * Duplicates (policy SKIP, UPDATE or CREATE) use the same normalisers as the duplicate check (B2.04): email, phone number, company
 * name; a row that repeats an earlier row of the same file counts as that row's duplicate.
 */

const PERMISSION = "configuration.manage";
export { MIGRATION_JOB };
export const STEPS = ["SOURCE", "UPLOAD", "MAP", "VALIDATE", "DRY_RUN", "IMPORT", "REVIEW"] as const;
const RUNNING = ["QUEUED", "IMPORTING"];
const DONE = ["COMPLETED", "COMPLETED_WITH_ERRORS", "CANCELLED"];
const MAX_NAME = 80;

function maxRows(): number {
  return Number(process.env.MIGRATION_MAX_ROWS) > 0 ? Number(process.env.MIGRATION_MAX_ROWS) : 50_000;
}

// ---------------------------------------------------------------------------
// Presenting
// ---------------------------------------------------------------------------

async function present(session: ImportSession) {
  const summary = (session.summary ?? {}) as { options?: { createMissingCompanies?: boolean }; validation?: { unmappedValues?: unknown[]; truncated?: boolean }; result?: unknown; rollback?: unknown; warnings?: unknown[] };
  const creator = session.createdByMembershipId
    ? await adminDb.membership.findFirst({ where: { id: session.createdByMembershipId, organizationId: session.organizationId }, select: { id: true, user: { select: { name: true, email: true } } } })
    : null;
  const stepIndex = STEPS.indexOf(session.step as (typeof STEPS)[number]);
  const finished = DONE.includes(session.status) || session.status === "ROLLED_BACK";
  const now = Date.now();
  const canRollback =
    DONE.includes(session.status) &&
    session.createdRows + session.updatedRows > 0 &&
    session.rollbackDeadline !== null &&
    session.rollbackDeadline.getTime() > now;
  return {
    id: session.id,
    entity: session.entity,
    sourceKind: session.sourceKind,
    status: session.status,
    step: session.step,
    running: RUNNING.includes(session.status),
    steps: STEPS.map((s, i) => ({ key: s, state: finished || i < stepIndex ? "done" : i === stepIndex ? "current" : "todo" })),
    file: session.fileId ? { name: session.fileName, headers: (session.headers ?? []) as string[], rows: session.totalRows } : null,
    mapping: session.mapping,
    valueMappings: session.valueMappings,
    duplicatePolicy: session.duplicatePolicy,
    options: { createMissingCompanies: summary.options?.createMissingCompanies ?? session.entity === "DEAL" },
    presetId: session.presetId,
    counts: {
      total: session.totalRows,
      valid: session.validRows,
      warnings: session.warningRows,
      errors: session.errorRows,
      duplicates: session.duplicateRows,
      processed: session.processedRows,
      created: session.createdRows,
      updated: session.updatedRows,
      skipped: session.skippedRows,
      failed: session.failedRows,
    },
    progress: session.totalRows > 0 ? Math.min(100, Math.round((session.processedRows / session.totalRows) * 100)) : 0,
    validation: summary.validation ?? null,
    dryRun: session.dryRun,
    result: summary.result ?? null,
    rollback: {
      canRollback,
      deadline: session.rollbackDeadline,
      rolledBackAt: session.rolledBackAt,
      result: summary.rollback ?? null,
    },
    warnings: summary.warnings ?? [],
    failureMessage: session.failureMessage,
    importedBy: creator ? { membershipId: creator.id, name: creator.user.name, email: creator.user.email } : null,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

async function load(ctx: AuthContext, id: string): Promise<ImportSession> {
  requirePermission(ctx, PERMISSION);
  const session = await adminDb.importSession.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!session) throw new NotFoundError("ImportSession", id);
  return session;
}

function requireEntity(entity: unknown): MigrationEntity {
  if (typeof entity !== "string" || !(MIGRATION_ENTITIES as readonly string[]).includes(entity)) {
    throw new ValidationError(`"${String(entity)}" cannot be migrated.`, [{ path: "entity", message: `Use one of: ${MIGRATION_ENTITIES.join(", ")}.` }]);
  }
  return entity as MigrationEntity;
}

// ---------------------------------------------------------------------------
// Catalogue and templates
// ---------------------------------------------------------------------------

export function describeField(f: FieldDef) {
  return { key: f.key, label: f.label, type: f.type, required: f.required === true, options: f.options ?? null, valueMapping: f.catalog ?? null, help: f.help ?? null };
}

export async function listMigrationEntities(ctx: AuthContext) {
  requirePermission(ctx, PERMISSION);
  const customFields = await adminDb.customFieldDefinition.findMany({ where: { organizationId: ctx.organizationId, isActive: true, section: "GENERAL" }, select: { entityType: true, key: true, label: true } });
  const cf = (entity: string) => customFields.filter((d) => d.entityType === entity).map((d) => ({ key: `cf:${d.key}`, label: d.label, type: "custom", required: false, options: null, valueMapping: null, help: "A custom field." }));
  return {
    items: MIGRATION_ENTITIES.map((entity) => ({
      entity,
      fields: [...FIELDS[entity].map(describeField), ...(["COMPANY", "CONTACT", "LEAD", "DEAL"].includes(entity) ? cf(entity) : [])],
      sourceKinds: ["TEMPLATE", "GENERIC"],
      maxRows: maxRows(),
    })),
    duplicatePolicies: ["SKIP", "UPDATE", "CREATE"],
    steps: STEPS,
  };
}

export function getMigrationTemplate(ctx: AuthContext, entity: string): string {
  requirePermission(ctx, PERMISSION);
  return templateCsv(requireEntity(entity));
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface CreateSessionInput {
  entity: string;
  sourceKind?: string;
  presetId?: string;
  duplicatePolicy?: string;
  createMissingCompanies?: boolean;
}

export async function createMigrationSession(ctx: AuthContext, input: CreateSessionInput) {
  requirePermission(ctx, PERMISSION);
  const entity = requireEntity(input.entity);
  const sourceKind = input.sourceKind ?? "GENERIC";
  if (!["TEMPLATE", "GENERIC"].includes(sourceKind)) throw new ValidationError("sourceKind must be TEMPLATE or GENERIC.", [{ path: "sourceKind", message: "TEMPLATE or GENERIC." }]);
  const policy = input.duplicatePolicy ?? "SKIP";
  if (!["SKIP", "UPDATE", "CREATE"].includes(policy)) throw new ValidationError("duplicatePolicy must be SKIP, UPDATE or CREATE.", [{ path: "duplicatePolicy", message: "SKIP, UPDATE or CREATE." }]);

  let mapping = {};
  let valueMappings = {};
  if (input.presetId) {
    const preset = await adminDb.importMappingPreset.findFirst({ where: { id: input.presetId, organizationId: ctx.organizationId, entity } });
    if (!preset) throw new NotFoundError("ImportMappingPreset", input.presetId);
    mapping = preset.mapping as object;
    valueMappings = preset.valueMappings as object;
  }
  const session = await adminDb.importSession.create({
    data: {
      organizationId: ctx.organizationId,
      entity,
      sourceKind,
      status: "DRAFT",
      step: "UPLOAD",
      mapping,
      valueMappings,
      duplicatePolicy: policy,
      presetId: input.presetId ?? null,
      createdByMembershipId: ctx.membershipId,
      summary: { options: { createMissingCompanies: input.createMissingCompanies ?? entity === "DEAL" } },
    },
  });
  return present(session);
}

export async function getMigrationSession(ctx: AuthContext, id: string) {
  return present(await load(ctx, id));
}

export async function listMigrationSessions(ctx: AuthContext, query: { entity?: string; status?: string; paging?: PageRequest } = {}) {
  requirePermission(ctx, PERMISSION);
  const paging = resolvePaging(query.paging);
  const where = { organizationId: ctx.organizationId, ...(query.entity ? { entity: query.entity } : {}), ...(query.status ? { status: query.status } : {}) };
  const [rows, total] = await Promise.all([
    adminDb.importSession.findMany({ where, orderBy: { createdAt: "desc" }, skip: paging.skip, take: paging.take }),
    adminDb.importSession.count({ where }),
  ]);
  return buildPage(await Promise.all(rows.map(present)), total, paging);
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

function looksBinary(data: Buffer): boolean {
  const sample = data.subarray(0, 4096);
  return sample.includes(0);
}

export async function uploadMigrationFile(ctx: AuthContext, id: string, input: { fileName: string; data: Buffer }) {
  const session = await load(ctx, id);
  if (RUNNING.includes(session.status) || DONE.includes(session.status) || session.status === "ROLLED_BACK") {
    throw new ValidationError("This migration can no longer take a new file. Start another one.", [{ path: "status", message: `It is ${session.status}.`, code: "SESSION_LOCKED" }]);
  }
  assertCsvRequestSize(input.data.length);
  if (input.data.length === 0) throw new ValidationError("The file is empty.", [{ path: "file", message: "Choose a CSV file with rows." }]);
  // A spreadsheet is read as its first sheet and stored as CSV, so everything after this point is the same for both.
  if (isXlsx(input.fileName, input.data)) {
    input = { fileName: input.fileName.replace(/\.xlsx$/i, ".csv"), data: await xlsxToCsv(input.data, maxRows()) };
  }
  if (looksBinary(input.data)) throw new ValidationError("That does not look like a CSV file. Save the spreadsheet as CSV and try again.", [{ path: "file", message: "Not a CSV file.", code: "NOT_CSV" }]);

  // Read the header and count the rows without keeping them.
  let headers: string[] = [];
  let rows = 0;
  try {
    const stream = Readable.from(input.data);
    const parser = (await import("csv-parse")).parse({ columns: (h: string[]) => { headers = h.map((x) => x.trim()); return headers; }, bom: true, skip_empty_lines: true, trim: true, relax_column_count: true });
    stream.pipe(parser);
    for await (const _ of parser) {
      void _;
      rows += 1;
      if (rows > maxRows()) break;
    }
  } catch (err) {
    throw new ValidationError(`The file could not be read as CSV: ${err instanceof Error ? err.message : "unknown error"}.`, [{ path: "file", message: "The CSV is malformed.", code: "CSV_MALFORMED" }]);
  }
  const issues: ValidationIssue[] = [];
  if (headers.length === 0 || headers.every((h) => !h)) issues.push({ path: "file", message: "The first row must name the columns." });
  if (headers.some((h) => !h)) issues.push({ path: "file", message: "Every column needs a name in the first row." });
  if (new Set(headers.map((h) => h.toLowerCase())).size !== headers.length) issues.push({ path: "file", message: "Two columns have the same name. Rename one." });
  if (headers.length > 100) issues.push({ path: "file", message: "At most 100 columns." });
  if (rows === 0) issues.push({ path: "file", message: "The file has a header but no rows." });
  if (rows > maxRows()) issues.push({ path: "file", message: `At most ${maxRows()} rows in one migration. Split the file.`, code: "TOO_MANY_ROWS" });
  if (issues.length > 0) throw new ValidationError(issues[0]!.message, issues);

  const checksum = createHash("sha256").update(input.data).digest("hex");
  const file = await storeGeneratedFile({
    organizationId: ctx.organizationId,
    ownerMembershipId: ctx.membershipId,
    purpose: "IMPORT",
    name: input.fileName.toLowerCase().endsWith(".csv") ? input.fileName : `${input.fileName}.csv`,
    mimeType: "text/csv",
    data: input.data,
  });

  // The same file imported before is worth a warning: a repeat would double the records unless duplicates are skipped.
  const sameFiles = await adminDb.file.findMany({ where: { organizationId: ctx.organizationId, purpose: "IMPORT", checksumSha256: checksum, id: { not: file.id } }, select: { id: true } });
  const earlier = sameFiles.length
    ? await adminDb.importSession.findFirst({ where: { organizationId: ctx.organizationId, id: { not: session.id }, fileId: { in: sameFiles.map((f) => f.id) }, status: { in: ["COMPLETED", "COMPLETED_WITH_ERRORS"] }, entity: session.entity }, orderBy: { finishedAt: "desc" } })
    : null;
  const warnings = earlier ? [{ code: "FILE_ALREADY_IMPORTED", message: "This exact file was already imported. Importing it again will skip or double its records depending on the duplicate policy.", sessionId: earlier.id, at: earlier.finishedAt }] : [];

  const entity = session.entity as MigrationEntity;
  const suggested = suggestMapping(entity, headers);
  // A mapping already chosen (a preset, an earlier upload) is kept where its columns still exist; otherwise the file's own headers decide.
  const existing = Object.fromEntries(Object.entries((session.mapping ?? {}) as Record<string, string>).filter(([, header]) => headers.includes(header)));
  const mapping = Object.keys(existing).length > 0 ? existing : suggested;
  await adminDb.importSessionIssue.deleteMany({ where: { organizationId: ctx.organizationId, sessionId: session.id } });
  const updated = await adminDb.importSession.update({
    where: { id: session.id },
    data: {
      status: "UPLOADED",
      step: "MAP",
      fileId: file.id,
      fileName: file.name,
      headers,
      totalRows: rows,
      mapping: mapping as Prisma.InputJsonValue,
      dryRun: Prisma.DbNull,
      validRows: 0,
      warningRows: 0,
      errorRows: 0,
      duplicateRows: 0,
      processedRows: 0,
      failureMessage: null,
      summary: { ...((session.summary ?? {}) as object), warnings, validation: undefined } as unknown as Prisma.InputJsonValue,
    },
  });
  return { session: await present(updated), suggestedMapping: suggested, unmappedHeaders: headers.filter((h) => !Object.values(mapping).includes(h)) };
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

export interface MappingInput {
  mapping?: Record<string, string>;
  valueMappings?: Record<string, Record<string, string>>;
  duplicatePolicy?: string;
  createMissingCompanies?: boolean;
  /** Save this mapping under a name, to start the next migration from it. */
  savePresetAs?: string;
  presetId?: string | null;
}

/** What has to be mapped for a row to mean anything, per kind of record. */
function missingRequiredMappings(entity: MigrationEntity, mapping: Record<string, string>): ValidationIssue[] {
  const has = (k: string) => Boolean(mapping[k]);
  const need = (k: string, label: string): ValidationIssue[] => (has(k) ? [] : [{ path: `mapping.${k}`, message: `Map a column to ${label}.`, code: "MAPPING_REQUIRED" }]);
  switch (entity) {
    case "COMPANY":
      return need("name", "the company name");
    case "CONTACT":
      return has("firstName") || has("fullName") ? [] : [{ path: "mapping.firstName", message: "Map a column to the first name, or to the full name.", code: "MAPPING_REQUIRED" }];
    case "LEAD":
      return ["contactName", "contactEmail", "contactPhone", "company"].some(has) ? [] : [{ path: "mapping.contactName", message: "Map a column to the contact (name, email or phone) or to the company.", code: "MAPPING_REQUIRED" }];
    case "DEAL":
      return [...need("company", "the company"), ...need("stage", "the pipeline stage")];
    case "TASK":
      return need("title", "the task title");
    case "ACTIVITY":
      return [...need("type", "the activity type"), ...need("occurredAt", "the date it happened"), ...(has("company") || has("contactEmail") ? [] : [{ path: "mapping.company", message: "Map a column to the company or the contact email, so each activity has somewhere to live.", code: "MAPPING_REQUIRED" }])];
  }
}

export async function setMigrationMapping(ctx: AuthContext, id: string, input: MappingInput) {
  const session = await load(ctx, id);
  if (!session.fileId) throw new ValidationError("Upload the file first.", [{ path: "status", message: "No file yet.", code: "NO_FILE" }]);
  if (RUNNING.includes(session.status) || DONE.includes(session.status) || session.status === "ROLLED_BACK") {
    throw new ValidationError("This migration can no longer be changed.", [{ path: "status", message: `It is ${session.status}.`, code: "SESSION_LOCKED" }]);
  }
  const entity = session.entity as MigrationEntity;
  const headers = (session.headers ?? []) as string[];
  const known = new Set(FIELDS[entity].map((f) => f.key));
  const customKeys = new Set(
    (await adminDb.customFieldDefinition.findMany({ where: { organizationId: ctx.organizationId, isActive: true, section: "GENERAL" }, select: { key: true, entityType: true } })).filter((d) => d.entityType === entity).map((d) => `cf:${d.key}`),
  );

  const mapping = input.mapping ?? ((session.mapping ?? {}) as Record<string, string>);
  const issues: ValidationIssue[] = [];
  for (const [field, header] of Object.entries(mapping)) {
    if (header === "" || header === undefined || header === null) continue;
    if (!known.has(field) && !customKeys.has(field)) issues.push({ path: `mapping.${field}`, message: `"${field}" is not a field of ${entity.toLowerCase()} records.`, code: "UNKNOWN_FIELD" });
    else if (!headers.includes(header)) issues.push({ path: `mapping.${field}`, message: `The file has no column called "${header}".`, code: "UNKNOWN_COLUMN" });
  }
  const cleanMapping = Object.fromEntries(Object.entries(mapping).filter(([, h]) => typeof h === "string" && h !== ""));
  const used = Object.values(cleanMapping);
  if (new Set(used).size !== used.length) issues.push({ path: "mapping", message: "Two fields use the same column. Each column maps to one field.", code: "COLUMN_REUSED" });
  issues.push(...missingRequiredMappings(entity, cleanMapping));

  const valueMappings = input.valueMappings ?? ((session.valueMappings ?? {}) as Record<string, Record<string, string>>);
  const mappable = new Set(FIELDS[entity].map((f) => f.key));
  for (const [field, table] of Object.entries(valueMappings)) {
    if (!mappable.has(field)) issues.push({ path: `valueMappings.${field}`, message: `"${field}" has no values to map.` });
    else if (!table || typeof table !== "object" || Object.values(table).some((v) => typeof v !== "string")) issues.push({ path: `valueMappings.${field}`, message: "Map each value in the file to a value in the CRM." });
  }
  const policy = input.duplicatePolicy ?? session.duplicatePolicy;
  if (!["SKIP", "UPDATE", "CREATE"].includes(policy)) issues.push({ path: "duplicatePolicy", message: "SKIP, UPDATE or CREATE." });
  if (issues.length > 0) throw new ValidationError(issues.length === 1 ? issues[0]!.message : "The mapping is not complete.", issues);

  let presetId = input.presetId === undefined ? session.presetId : input.presetId;
  if (input.savePresetAs !== undefined) {
    const name = input.savePresetAs.trim();
    if (!name || name.length > MAX_NAME) throw new ValidationError("Give the preset a name of 1 to 80 characters.", [{ path: "savePresetAs", message: "1 to 80 characters." }]);
    presetId = (await upsertPreset(ctx, { name, entity, mapping: cleanMapping, valueMappings })).id;
  }
  const base = (session.summary ?? {}) as { options?: object };
  await adminDb.importSessionIssue.deleteMany({ where: { organizationId: ctx.organizationId, sessionId: session.id } });
  const updated = await adminDb.importSession.update({
    where: { id: session.id },
    data: {
      mapping: cleanMapping as Prisma.InputJsonValue,
      valueMappings: valueMappings as Prisma.InputJsonValue,
      duplicatePolicy: policy,
      presetId: presetId ?? null,
      status: "MAPPED",
      step: "VALIDATE",
      // Changing the mapping makes every earlier result stale.
      dryRun: Prisma.DbNull,
      validRows: 0,
      warningRows: 0,
      errorRows: 0,
      duplicateRows: 0,
      processedRows: 0,
      failureMessage: null,
      summary: { ...base, options: { ...(base.options ?? {}), createMissingCompanies: input.createMissingCompanies ?? (base.options as { createMissingCompanies?: boolean } | undefined)?.createMissingCompanies ?? entity === "DEAL" }, validation: undefined } as unknown as Prisma.InputJsonValue,
    },
  });
  return present(updated);
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

async function enqueue(ctx: AuthContext, session: ImportSession, phase: Phase | "ROLLBACK", status: string) {
  const job = await enqueueJobFor({ organizationId: ctx.organizationId, type: MIGRATION_JOB, payload: { sessionId: session.id, phase, actorMembershipId: ctx.membershipId }, createdByMembershipId: ctx.membershipId });
  return adminDb.importSession.update({ where: { id: session.id }, data: { status, step: phase === "ROLLBACK" ? "REVIEW" : phase, jobId: job.id, failureMessage: null, cancelRequested: false } });
}

function assertIdle(session: ImportSession) {
  if (RUNNING.includes(session.status)) {
    throw new ValidationError("This migration is already running.", [{ path: "status", message: "Wait for it to finish, or cancel it.", code: "ALREADY_RUNNING" }]);
  }
}

export async function startMigrationValidation(ctx: AuthContext, id: string) {
  const session = await load(ctx, id);
  assertIdle(session);
  if (!["MAPPED", "VALIDATED", "DRY_RUN_DONE"].includes(session.status)) {
    throw new ValidationError("Map the fields before validating.", [{ path: "status", message: `It is ${session.status}.`, code: "WRONG_STEP" }]);
  }
  return present(await enqueue(ctx, session, "VALIDATE", "QUEUED"));
}

export async function startMigrationDryRun(ctx: AuthContext, id: string) {
  const session = await load(ctx, id);
  assertIdle(session);
  if (!["VALIDATED", "DRY_RUN_DONE"].includes(session.status)) {
    throw new ValidationError("Validate the file before the dry run.", [{ path: "status", message: `It is ${session.status}.`, code: "WRONG_STEP" }]);
  }
  return present(await enqueue(ctx, session, "DRY_RUN", "QUEUED"));
}

export async function startMigrationImport(ctx: AuthContext, id: string, input: { confirm?: boolean } = {}) {
  const session = await load(ctx, id);
  assertIdle(session);
  if (session.status !== "DRY_RUN_DONE") {
    throw new ValidationError("Run the dry run before importing, so you have seen what will happen.", [{ path: "status", message: `It is ${session.status}.`, code: "DRY_RUN_REQUIRED" }]);
  }
  if (input.confirm !== true) {
    throw new ValidationError("Confirm the import.", [{ path: "confirm", message: "Send confirm: true once you have read the dry run.", code: "CONFIRM_REQUIRED" }]);
  }
  const dry = (session.dryRun ?? {}) as { wouldCreate?: number; wouldUpdate?: number };
  if ((dry.wouldCreate ?? 0) + (dry.wouldUpdate ?? 0) === 0) {
    throw new ValidationError("The dry run found nothing to import.", [{ path: "status", message: "Every row was an error or a duplicate.", code: "NOTHING_TO_IMPORT" }]);
  }
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "data_migration.started",
    entityType: "ImportSession",
    entityId: session.id,
    metadata: { entity: session.entity, file: session.fileName, policy: session.duplicatePolicy, rows: session.totalRows },
  });
  return present(await enqueue(ctx, session, "IMPORT", "QUEUED"));
}

/** Stops a running or waiting migration at the next chunk. Rows already written stay, and can be rolled back. */
export async function cancelMigration(ctx: AuthContext, id: string) {
  const session = await load(ctx, id);
  if (!RUNNING.includes(session.status)) return present(session);
  const queued = session.status === "QUEUED";
  const step = session.step;
  const updated = await adminDb.importSession.update({
    where: { id: session.id },
    data: queued
      ? { cancelRequested: true, status: step === "IMPORT" ? "CANCELLED" : step === "DRY_RUN" ? "VALIDATED" : "MAPPED", finishedAt: step === "IMPORT" ? new Date() : undefined }
      : { cancelRequested: true },
  });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "data_migration.cancelled", entityType: "ImportSession", entityId: session.id, metadata: { step } });
  return present(updated);
}

export async function rollbackMigration(ctx: AuthContext, id: string) {
  const session = await load(ctx, id);
  assertIdle(session);
  if (session.status === "ROLLED_BACK") throw new ValidationError("This migration was already rolled back.", [{ path: "status", message: "Already rolled back.", code: "ALREADY_ROLLED_BACK" }]);
  if (!DONE.includes(session.status) || session.createdRows + session.updatedRows === 0) {
    throw new ValidationError("There is nothing to roll back.", [{ path: "status", message: "This migration has not written any records.", code: "NOTHING_TO_ROLL_BACK" }]);
  }
  if (!session.rollbackDeadline || session.rollbackDeadline.getTime() <= Date.now()) {
    throw new ValidationError(`The rollback window (${Math.round(rollbackWindowMs() / 3_600_000)} hours after the import) has passed.`, [{ path: "status", message: "The window has passed.", code: "ROLLBACK_WINDOW_PASSED" }]);
  }
  return present(await enqueue(ctx, session, "ROLLBACK", "QUEUED"));
}

/** The job handler: one phase of one session. Never throws for a problem with the data; the session records it. */
export async function runMigrationJob(organizationId: string, payload: { sessionId: string; phase: Phase | "ROLLBACK" }, actorMembershipId?: string | null): Promise<void> {
  if (payload.phase === "ROLLBACK") {
    const session = await adminDb.importSession.findFirst({ where: { id: payload.sessionId, organizationId } });
    if (!session) return;
    await adminDb.importSession.update({ where: { id: session.id }, data: { status: "IMPORTING", step: "REVIEW" } });
    try {
      await runRollback(organizationId, session.id, actorMembershipId ?? session.createdByMembershipId ?? "");
    } catch (err) {
      await adminDb.importSession.update({ where: { id: session.id }, data: { status: session.status === "ROLLED_BACK" ? "ROLLED_BACK" : "COMPLETED_WITH_ERRORS", failureMessage: (err instanceof Error ? err.message : "The rollback stopped.").slice(0, 500) } });
    }
    return;
  }
  await runPass(organizationId, payload.sessionId, payload.phase);
}

// ---------------------------------------------------------------------------
// Issues and the error report
// ---------------------------------------------------------------------------

export async function listMigrationIssues(ctx: AuthContext, id: string, query: { phase?: string; severity?: string; paging?: PageRequest } = {}) {
  const session = await load(ctx, id);
  const paging = resolvePaging(query.paging);
  if (query.phase !== undefined && !["VALIDATE", "IMPORT"].includes(query.phase)) throw new ValidationError("phase must be VALIDATE or IMPORT.", [{ path: "phase", message: "VALIDATE or IMPORT." }]);
  if (query.severity !== undefined && !["ERROR", "WARNING", "DUPLICATE"].includes(query.severity)) throw new ValidationError("severity must be ERROR, WARNING or DUPLICATE.", [{ path: "severity", message: "ERROR, WARNING or DUPLICATE." }]);
  const where = { organizationId: ctx.organizationId, sessionId: session.id, ...(query.phase ? { phase: query.phase } : {}), ...(query.severity ? { severity: query.severity } : {}) };
  const [rows, total] = await Promise.all([
    adminDb.importSessionIssue.findMany({ where, orderBy: [{ rowNumber: "asc" }, { id: "asc" }], skip: paging.skip, take: paging.take }),
    adminDb.importSessionIssue.count({ where }),
  ]);
  return buildPage(
    rows.map((r) => ({ row: r.rowNumber, phase: r.phase, severity: r.severity, field: r.field, message: r.message, matchedRecordId: r.matchedId })),
    total,
    paging,
  );
}

export async function getMigrationErrorReport(ctx: AuthContext, id: string, phase: "VALIDATE" | "IMPORT" | "ALL" = "ALL"): Promise<Buffer> {
  const session = await load(ctx, id);
  return buildErrorReport(session, phase);
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

async function upsertPreset(ctx: AuthContext, input: { name: string; entity: MigrationEntity; mapping: Record<string, string>; valueMappings: Record<string, Record<string, string>> }) {
  const existing = await adminDb.importMappingPreset.findFirst({ where: { organizationId: ctx.organizationId, entity: input.entity, name: { equals: input.name, mode: "insensitive" } } });
  const data = { mapping: input.mapping as Prisma.InputJsonValue, valueMappings: input.valueMappings as Prisma.InputJsonValue };
  const preset = existing
    ? await adminDb.importMappingPreset.update({ where: { id: existing.id }, data })
    : await adminDb.importMappingPreset.create({ data: { organizationId: ctx.organizationId, name: input.name, entity: input.entity, createdByMembershipId: ctx.membershipId, ...data } });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: existing ? "import_preset.updated" : "import_preset.created", entityType: "ImportMappingPreset", entityId: preset.id, metadata: { entity: input.entity, name: input.name } });
  return preset;
}

export async function listMigrationPresets(ctx: AuthContext, entity?: string) {
  requirePermission(ctx, PERMISSION);
  if (entity !== undefined) requireEntity(entity);
  const rows = await adminDb.importMappingPreset.findMany({ where: { organizationId: ctx.organizationId, ...(entity ? { entity } : {}) }, orderBy: [{ entity: "asc" }, { name: "asc" }] });
  return { items: rows.map((p) => ({ id: p.id, name: p.name, entity: p.entity, mapping: p.mapping, valueMappings: p.valueMappings, updatedAt: p.updatedAt })) };
}

export async function saveMigrationPreset(ctx: AuthContext, input: { name: string; entity: string; mapping: Record<string, string>; valueMappings?: Record<string, Record<string, string>> }) {
  requirePermission(ctx, PERMISSION);
  const entity = requireEntity(input.entity);
  const name = (input.name ?? "").trim();
  if (!name || name.length > MAX_NAME) throw new ValidationError("Give the preset a name of 1 to 80 characters.", [{ path: "name", message: "1 to 80 characters." }]);
  const known = new Set(FIELDS[entity].map((f) => f.key));
  const bad = Object.keys(input.mapping ?? {}).filter((k) => !known.has(k) && !k.startsWith("cf:"));
  if (bad.length > 0) throw new ValidationError("The preset maps fields this kind of record does not have.", bad.map((k) => ({ path: `mapping.${k}`, message: "Unknown field." })));
  const preset = await upsertPreset(ctx, { name, entity, mapping: input.mapping ?? {}, valueMappings: input.valueMappings ?? {} });
  return { id: preset.id, name: preset.name, entity: preset.entity, mapping: preset.mapping, valueMappings: preset.valueMappings };
}

export async function deleteMigrationPreset(ctx: AuthContext, id: string) {
  requirePermission(ctx, PERMISSION);
  const preset = await adminDb.importMappingPreset.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!preset) throw new NotFoundError("ImportMappingPreset", id);
  await adminDb.importMappingPreset.delete({ where: { id } });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "import_preset.deleted", entityType: "ImportMappingPreset", entityId: id, metadata: { name: preset.name, entity: preset.entity } });
  return { id, deleted: true as const };
}

