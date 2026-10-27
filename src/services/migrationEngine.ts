import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { ImportSession, Prisma } from "@prisma/client";
import { adminDb } from "../db/adminClient";
import { type OrgScopedClient, withOrgContext } from "../db/orgScopedClient";
import { parseCsvRows, stringifyCsv as stringify } from "../lib/csv";
import { logger } from "../lib/logger";
import { type MigrationEntity, MIGRATION_ENTITIES } from "../lib/migrationFields";
import { recordAuditEvent } from "../repositories/auditEvents";
import { getStorageDriver } from "../storage";
import { FILE_POLICIES } from "../storage/policy";
import { enqueueJobFor } from "../jobs/runner";
import {
  type ResolvedRow,
  type RowOptions,
  type UnmappedValue,
  loadLookups,
  remember,
  resolveRow,
} from "./migrationRows";

/**
 * The migration engine (FIG-1061, B4.04): one pass over the file, three ways to run it.
 *
 *   VALIDATE  every row is read and checked; nothing is looked up for duplicates and nothing is written.
 *   DRY_RUN   the import without the writing: duplicates are decided as the import would decide them, and the answer is counts and a sample.
 *   IMPORT    the same decisions, written in chunks inside the organisation's RLS context. Every row created carries the session id,
 *             and what was done to every record is kept (`import_session_changes`) so the whole session can be rolled back.
 *
 * Rows are resolved in memory against lookups loaded once (`migrationRows.ts`) and written 200 at a time with `createMany`, which
 * is what makes 10,000 rows a matter of a minute. A chunk that fails as a whole is retried row by row so one bad row costs one row.
 */

export type Phase = "VALIDATE" | "DRY_RUN" | "IMPORT";
export const CHUNK_SIZE = 200;
export const MAX_STORED_ISSUES = 10_000;
export const MAX_SAMPLE = 10;
const WRITE_TIMEOUT_MS = 60_000;

export interface SessionOptions {
  createMissingCompanies: boolean;
}

export function rollbackWindowMs(): number {
  const hours = Number(process.env.MIGRATION_ROLLBACK_WINDOW_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : 72) * 3_600_000;
}

function rowOptions(session: ImportSession): RowOptions {
  const stored = (session.summary ?? {}) as { options?: Partial<SessionOptions> };
  return {
    mapping: (session.mapping ?? {}) as Record<string, string>,
    valueMappings: (session.valueMappings ?? {}) as Record<string, Record<string, string>>,
    createMissingCompanies: stored.options?.createMissingCompanies ?? session.entity === "DEAL",
  };
}

async function readFile(session: ImportSession): Promise<Buffer> {
  const file = session.fileId ? await adminDb.file.findFirst({ where: { id: session.fileId, organizationId: session.organizationId } }) : null;
  if (!file || file.status !== "READY") throw new Error("The uploaded file is no longer available.");
  return getStorageDriver().getObject(file.storageKey, FILE_POLICIES.IMPORT.maxBytes);
}

// ---------------------------------------------------------------------------
// Plans and writing
// ---------------------------------------------------------------------------

interface PlannedCreate {
  row: number;
  id: string;
  data: Record<string, unknown>;
  tags: string[];
}
interface PlannedUpdate {
  row: number;
  id: string;
  resolved: ResolvedRow;
}
interface ChunkPlan {
  newCompanies: { id: string; data: Record<string, unknown> }[];
  newContacts: { id: string; data: Record<string, unknown> }[];
  creates: PlannedCreate[];
  updates: PlannedUpdate[];
}

const emptyPlan = (): ChunkPlan => ({ newCompanies: [], newContacts: [], creates: [], updates: [] });

type Delegate = {
  createMany: (args: unknown) => Promise<{ count: number }>;
  findMany: (args: unknown) => Promise<Record<string, unknown>[]>;
  update: (args: unknown) => Promise<unknown>;
  deleteMany: (args: unknown) => Promise<{ count: number }>;
  updateMany: (args: unknown) => Promise<{ count: number }>;
};

function delegateFor(tx: OrgScopedClient, entity: MigrationEntity): Delegate {
  const map = { COMPANY: tx.company, CONTACT: tx.contact, LEAD: tx.lead, DEAL: tx.deal, TASK: tx.task, ACTIVITY: tx.activity } as const;
  return map[entity] as unknown as Delegate;
}

const TAGGABLE: Record<string, "companyId" | "contactId" | "leadId" | "dealId"> = { COMPANY: "companyId", CONTACT: "contactId", LEAD: "leadId", DEAL: "dealId" };

/** Which fields of a record an UPDATE policy may change, and how a value from the row maps onto the stored one. */
const UPDATABLE: Record<string, readonly string[]> = {
  COMPANY: ["industry", "website", "location", "phone", "email", "notes", "lifecycleStateId", "ownerMembershipId"],
  CONTACT: ["lastName", "email", "phone", "companyId", "jobTitle", "department", "notes", "ownerMembershipId"],
  LEAD: ["leadSourceId", "serviceInterestId", "temperature", "notes", "ownerMembershipId", "companyId"],
  DEAL: ["primaryContactId", "serviceId", "value", "currency", "expectedCloseDate", "notes", "ownerMembershipId"],
};

const jsonish = (v: unknown) => JSON.stringify(v instanceof Date ? v.toISOString() : v === undefined ? null : v);

async function writePlan(
  tx: OrgScopedClient,
  session: ImportSession,
  plan: ChunkPlan,
  newTagIds: Map<string, string>,
  importerId: string,
  tagIdFor: (name: string) => string,
): Promise<{ created: number; updated: number }> {
  const orgId = session.organizationId;
  const entity = session.entity as MigrationEntity;
  const stamp = { organizationId: orgId, importSessionId: session.id };
  const changes: Prisma.ImportSessionChangeCreateManyInput[] = [];

  if (newTagIds.size > 0) {
    await tx.tag.createMany({ data: [...newTagIds].map(([name, id]) => ({ id, organizationId: orgId, name, createdByMembershipId: importerId })), skipDuplicates: true });
  }
  if (plan.newCompanies.length > 0) {
    await tx.company.createMany({ data: plan.newCompanies.map((c) => ({ ...c.data, id: c.id, ...stamp }) as never), skipDuplicates: true });
    for (const c of plan.newCompanies) changes.push({ organizationId: orgId, sessionId: session.id, entity: "COMPANY", recordId: c.id, action: "CREATED" });
  }
  if (plan.newContacts.length > 0) {
    await tx.contact.createMany({ data: plan.newContacts.map((c) => ({ ...c.data, id: c.id, createdByMembershipId: importerId, ...stamp }) as never), skipDuplicates: true });
    for (const c of plan.newContacts) changes.push({ organizationId: orgId, sessionId: session.id, entity: "CONTACT", recordId: c.id, action: "CREATED" });
  }
  if (plan.creates.length > 0) {
    await delegateFor(tx, entity).createMany({ data: plan.creates.map((c) => ({ ...c.data, id: c.id, ...stamp })), skipDuplicates: false });
    for (const c of plan.creates) changes.push({ organizationId: orgId, sessionId: session.id, entity, recordId: c.id, action: "CREATED" });
    const column = TAGGABLE[entity];
    if (column) {
      const links = plan.creates.flatMap((c) => c.tags.map((t) => ({ organizationId: orgId, tagId: newTagIds.get(t) ?? tagIdFor(t), [column]: c.id, createdByMembershipId: importerId })));
      if (links.length > 0) await tx.tagLink.createMany({ data: links as never, skipDuplicates: true });
    }
  }

  let updated = 0;
  if (plan.updates.length > 0) {
    const delegate = delegateFor(tx, entity);
    const fields = UPDATABLE[entity] ?? [];
    const current = new Map((await delegate.findMany({ where: { id: { in: plan.updates.map((u) => u.id) }, organizationId: orgId } })).map((r) => [r.id as string, r]));
    for (const u of plan.updates) {
      const row = current.get(u.id);
      if (!row) continue;
      const patch: Record<string, unknown> = {};
      const before: Record<string, unknown> = {};
      for (const f of fields) {
        if (!u.resolved.provided.includes(patchKey(entity, f)) || u.resolved.data[f] === undefined) continue;
        if (jsonish(row[f]) !== jsonish(u.resolved.data[f])) {
          patch[f] = u.resolved.data[f];
          before[f] = row[f] ?? null;
        }
      }
      if (u.resolved.provided.includes("customFields") && u.resolved.data.customFields && Object.keys(u.resolved.data.customFields as object).length > 0) {
        const merged = { ...((row.customFields as object | null) ?? {}), ...(u.resolved.data.customFields as object) };
        if (jsonish(merged) !== jsonish(row.customFields)) {
          patch.customFields = merged;
          before.customFields = row.customFields ?? {};
        }
      }
      if (Object.keys(patch).length > 0) {
        await delegate.update({ where: { id: u.id }, data: patch });
        changes.push({ organizationId: orgId, sessionId: session.id, entity, recordId: u.id, action: "UPDATED", previous: { before, after: patch } as unknown as Prisma.InputJsonValue });
        updated += 1;
      }
      const column = TAGGABLE[entity];
      if (column && u.resolved.tags.length > 0) {
        await tx.tagLink.createMany({ data: u.resolved.tags.map((t) => ({ organizationId: orgId, tagId: newTagIds.get(t) ?? tagIdFor(t), [column]: u.id, createdByMembershipId: importerId })) as never, skipDuplicates: true });
      }
    }
  }
  if (changes.length > 0) await tx.importSessionChange.createMany({ data: changes });
  return { created: plan.creates.length, updated };
}

/** The field a mapping key is stored under in `provided` (a few differ from the column: lifecycleState, serviceInterest...). */
function patchKey(entity: MigrationEntity, column: string): string {
  const map: Record<string, string> = { lifecycleStateId: "lifecycleState", ownerMembershipId: "ownerEmail", leadSourceId: "leadSource", serviceInterestId: "serviceInterest", serviceId: "service", primaryContactId: "contactEmail", companyId: "company" };
  void entity;
  return map[column] ?? column;
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

interface PassResult {
  total: number;
  valid: number;
  warnings: number;
  errors: number;
  duplicates: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  newCompanies: number;
  newContacts: number;
  newTags: number;
  unmapped: Map<string, number>;
  sample: { create: Record<string, string>[]; update: { id: string; changes: string[] }[]; duplicate: { row: number; reason: string }[] };
  cancelled: boolean;
  truncated: boolean;
}

function newResult(): PassResult {
  return { total: 0, valid: 0, warnings: 0, errors: 0, duplicates: 0, created: 0, updated: 0, skipped: 0, failed: 0, newCompanies: 0, newContacts: 0, newTags: 0, unmapped: new Map(), sample: { create: [], update: [], duplicate: [] }, cancelled: false, truncated: false };
}

export class MigrationFailure extends Error {}

export async function runPass(organizationId: string, sessionId: string, phase: Phase, now = new Date()): Promise<void> {
  const session = await adminDb.importSession.findFirst({ where: { id: sessionId, organizationId } });
  if (!session) return;
  const entity = session.entity as MigrationEntity;
  if (!(MIGRATION_ENTITIES as readonly string[]).includes(entity)) return;
  const stepOf = { VALIDATE: "VALIDATE", DRY_RUN: "DRY_RUN", IMPORT: "IMPORT" } as const;
  const issuePhase = phase === "IMPORT" ? "IMPORT" : "VALIDATE";

  const revert = phase === "IMPORT" ? "FAILED" : phase === "DRY_RUN" ? "VALIDATED" : "MAPPED";
  try {
    if (session.status === "CANCELLED") return;
    const importer = session.createdByMembershipId
      ? await adminDb.membership.findFirst({ where: { id: session.createdByMembershipId, organizationId, status: "ACTIVE" }, select: { id: true } })
      : null;
    if (!importer) throw new MigrationFailure("The person who started this migration is no longer an active member.");

    await adminDb.importSession.update({
      where: { id: session.id },
      data: {
        status: "IMPORTING",
        step: stepOf[phase],
        failureMessage: null,
        cancelRequested: false,
        processedRows: 0,
        ...(phase === "IMPORT" ? { startedAt: now, createdRows: 0, updatedRows: 0, skippedRows: 0, failedRows: 0, duplicateRows: 0 } : {}),
      },
    });
    await adminDb.importSessionIssue.deleteMany({ where: { organizationId, sessionId, phase: issuePhase } });

    const bytes = await readFile(session);
    const opts = rowOptions(session);
    const lk = await loadLookups(organizationId, importer.id, entity);
    const result = newResult();
    const maxRows = Number(process.env.MIGRATION_MAX_ROWS) > 0 ? Number(process.env.MIGRATION_MAX_ROWS) : 50_000;
    let storedIssues = 0;
    let issueBuffer: Prisma.ImportSessionIssueCreateManyInput[] = [];
    const policy = session.duplicatePolicy as "SKIP" | "UPDATE" | "CREATE";
    const isCancelled = async () => (await adminDb.importSession.findUnique({ where: { id: session.id }, select: { cancelRequested: true } }))?.cancelRequested === true;

    const pushIssue = (row: number, severity: "ERROR" | "WARNING" | "DUPLICATE", message: string, field?: string, matchedId?: string) => {
      if (storedIssues >= MAX_STORED_ISSUES) return;
      storedIssues += 1;
      issueBuffer.push({ organizationId, sessionId, phase: issuePhase, rowNumber: row, severity, field: field ?? null, message: message.slice(0, 500), matchedId: matchedId ?? null });
    };
    const flushIssues = async () => {
      if (issueBuffer.length === 0) return;
      const batch = issueBuffer;
      issueBuffer = [];
      await adminDb.importSessionIssue.createMany({ data: batch });
    };
    const noteUnmapped = (list: UnmappedValue[]) => {
      for (const u of list) result.unmapped.set(`${u.field}\u0000${u.value}`, (result.unmapped.get(`${u.field}\u0000${u.value}`) ?? 0) + 1);
    };

    let chunk: { raw: Record<string, string>; row: number }[] = [];
    let rowNumber = 1;

    const processChunk = async () => {
      const batch = chunk;
      chunk = [];
      if (batch.length === 0) return;
      const plan = emptyPlan();
      const newTagNames = new Map<string, string>(); // lower case -> first spelling

      for (const { raw, row } of batch) {
        const resolved = resolveRow(entity, raw, opts, lk, now);
        if (!resolved.ok) {
          result.errors += 1;
          result.failed += phase === "IMPORT" ? 1 : 0;
          for (const i of resolved.issues) pushIssue(row, i.severity, i.message, i.field);
          noteUnmapped(resolved.unmapped);
          continue;
        }
        for (const w of resolved.warnings) pushIssue(row, "WARNING", w.message, w.field);
        if (resolved.warnings.length > 0) result.warnings += 1;
        result.valid += 1;
        if (phase === "VALIDATE") continue;

        // Duplicates, decided the same way for the dry run and the import.
        if (resolved.match && policy !== "CREATE") {
          const canUpdate = policy === "UPDATE" && ["COMPANY", "CONTACT", "LEAD", "DEAL"].includes(entity);
          if (!canUpdate) {
            result.duplicates += 1;
            result.skipped += 1;
            pushIssue(row, "DUPLICATE", `Skipped: ${resolved.match.reason}`, undefined, resolved.match.id);
            if (result.sample.duplicate.length < MAX_SAMPLE) result.sample.duplicate.push({ row, reason: resolved.match.reason });
            continue;
          }
          result.updated += phase === "DRY_RUN" ? 1 : 0;
          if (result.sample.update.length < MAX_SAMPLE) result.sample.update.push({ id: resolved.match.id, changes: resolved.provided });
          plan.updates.push({ row, id: resolved.match.id, resolved });
          for (const t of resolved.tags) if (!lk.tags.has(t.toLowerCase())) newTagNames.set(t.toLowerCase(), newTagNames.get(t.toLowerCase()) ?? t);
          continue;
        }

        // A new record. Companies and contacts it needs are created first, once each.
        const id = randomUUID();
        if (resolved.newCompany) {
          const key = resolved.newCompany.key;
          let companyId = lk.pendingCompanies.get(key);
          if (!companyId) {
            companyId = randomUUID();
            lk.pendingCompanies.set(key, companyId);
            lk.companiesByName.set(key, [companyId]);
            result.newCompanies += 1;
            plan.newCompanies.push({ id: companyId, data: { name: resolved.newCompany.name, createdByMembershipId: importer.id, ownerMembershipId: importer.id } });
          }
          resolved.data.companyId = companyId;
          if (resolved.newContact) resolved.newContact.data.companyId = companyId;
        }
        if (resolved.newContact) {
          result.newContacts += 1;
          plan.newContacts.push({ id: resolved.newContact.id, data: { ...resolved.newContact.data, ownerMembershipId: importer.id } });
        }
        remember(entity, resolved, id, lk);
        for (const t of resolved.tags) if (!lk.tags.has(t.toLowerCase())) newTagNames.set(t.toLowerCase(), newTagNames.get(t.toLowerCase()) ?? t);
        if (result.sample.create.length < MAX_SAMPLE) result.sample.create.push({ row: String(row), ...resolved.preview });
        plan.creates.push({ row, id, data: resolved.data, tags: resolved.tags });
        if (phase === "DRY_RUN") result.created += 1;
      }

      result.newTags += newTagNames.size;
      if (phase === "DRY_RUN") {
        for (const key of newTagNames.keys()) lk.tags.set(key, "dry-run");
        return;
      }
      if (phase !== "IMPORT") return;

      // Write. New tags get ids now; the lookup is updated only once the chunk is safely in.
      const newTagIds = new Map<string, string>([...newTagNames.values()].map((t) => [t, randomUUID()]));
      const tagIdFor = (name: string): string => {
        const id = [...newTagIds].find(([n]) => n.toLowerCase() === name.toLowerCase())?.[1] ?? lk.tags.get(name.toLowerCase());
        if (!id) throw new Error(`Unknown tag ${name}`);
        return id;
      };
      try {
        const out = await withOrgContext(organizationId, (tx) => writePlan(tx, session, plan, newTagIds, importer.id, tagIdFor), { timeoutMs: WRITE_TIMEOUT_MS });
        result.created += out.created;
        result.updated += out.updated;
        result.skipped += plan.updates.length - out.updated;
        for (const [name, id] of newTagIds) lk.tags.set(name.toLowerCase(), id);
      } catch (chunkErr) {
        logger.warn({ err: chunkErr, sessionId }, "Migration chunk failed; retrying row by row");
        // One bad row must not cost the other 199: write each row alone.
        const dependsOn = (c: PlannedCreate) => ({
          newCompanies: plan.newCompanies.filter((n) => n.id === c.data.companyId),
          newContacts: plan.newContacts.filter((n) => n.id === c.data.contactId),
        });
        for (const c of plan.creates) {
          const single: ChunkPlan = { ...emptyPlan(), creates: [c], ...dependsOn(c) };
          const tagsHere = new Map([...newTagIds].filter(([name]) => c.tags.some((t) => t.toLowerCase() === name.toLowerCase())));
          try {
            const out = await withOrgContext(organizationId, (tx) => writePlan(tx, session, single, tagsHere, importer.id, tagIdFor), { timeoutMs: WRITE_TIMEOUT_MS });
            result.created += out.created;
            for (const [name, id] of tagsHere) lk.tags.set(name.toLowerCase(), id);
          } catch (err) {
            result.failed += 1;
            result.errors += 1;
            result.valid -= 1;
            pushIssue(c.row, "ERROR", `Could not be saved: ${err instanceof Error ? err.message.split("\n").pop() : "unknown error"}`.slice(0, 300));
          }
        }
        for (const u of plan.updates) {
          try {
            const out = await withOrgContext(organizationId, (tx) => writePlan(tx, session, { ...emptyPlan(), updates: [u] }, new Map(), importer.id, tagIdFor), { timeoutMs: WRITE_TIMEOUT_MS });
            result.updated += out.updated;
          } catch (err) {
            result.failed += 1;
            result.errors += 1;
            pushIssue(u.row, "ERROR", `Could not be updated: ${err instanceof Error ? err.message.split("\n").pop() : "unknown error"}`.slice(0, 300));
          }
        }
      }
    };

    const progress = async () => {
      await flushIssues();
      await adminDb.importSession.update({
        where: { id: session.id },
        data: {
          processedRows: result.total,
          ...(phase === "IMPORT" ? { createdRows: result.created, updatedRows: result.updated, skippedRows: result.skipped, failedRows: result.failed, duplicateRows: result.duplicates } : {}),
        },
      });
    };

    for await (const raw of parseCsvRows(Readable.from(bytes))) {
      rowNumber += 1;
      if (rowNumber - 1 > maxRows) {
        result.truncated = true;
        break;
      }
      result.total = rowNumber - 1;
      chunk.push({ raw, row: rowNumber });
      if (chunk.length >= CHUNK_SIZE) {
        await processChunk();
        await progress();
        if (await isCancelled()) {
          result.cancelled = true;
          break;
        }
      }
    }
    if (!result.cancelled) await processChunk();
    await progress();

    await finish(session, phase, result, importer.id, now);
  } catch (err) {
    const message = err instanceof Error ? err.message : "The migration stopped unexpectedly.";
    logger.error({ err, sessionId, phase }, "Migration pass failed");
    await adminDb.importSession.update({
      where: { id: sessionId },
      data: { status: revert, failureMessage: message.slice(0, 500), ...(phase === "IMPORT" ? { finishedAt: new Date() } : {}) },
    });
  }
}

async function finish(session: ImportSession, phase: Phase, r: PassResult, importerId: string, now: Date): Promise<void> {
  const organizationId = session.organizationId;
  const unmappedValues = [...r.unmapped].map(([k, count]) => {
    const [field, value] = k.split("\u0000");
    return { field: field!, value: value!, count };
  }).sort((a, b) => b.count - a.count).slice(0, 100);
  const base = (session.summary ?? {}) as Record<string, unknown>;

  if (phase === "VALIDATE") {
    await adminDb.importSession.update({
      where: { id: session.id },
      data: {
        status: r.cancelled ? "MAPPED" : "VALIDATED",
        step: "VALIDATE",
        totalRows: r.total,
        validRows: r.valid,
        warningRows: r.warnings,
        errorRows: r.errors,
        processedRows: r.total,
        summary: { ...base, validation: { unmappedValues, truncated: r.truncated, at: now.toISOString() } } as unknown as Prisma.InputJsonValue,
      },
    });
    return;
  }
  if (phase === "DRY_RUN") {
    await adminDb.importSession.update({
      where: { id: session.id },
      data: {
        status: r.cancelled ? "VALIDATED" : "DRY_RUN_DONE",
        step: "DRY_RUN",
        totalRows: r.total,
        errorRows: r.errors,
        duplicateRows: r.duplicates,
        processedRows: r.total,
        dryRun: {
          at: now.toISOString(),
          totalRows: r.total,
          wouldCreate: r.created,
          wouldUpdate: r.updated,
          wouldSkip: r.skipped,
          duplicates: r.duplicates,
          errors: r.errors,
          warnings: r.warnings,
          newCompanies: r.newCompanies,
          newContacts: r.newContacts,
          newTags: r.newTags,
          unmappedValues,
          truncated: r.truncated,
          sample: r.sample,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    return;
  }

  // IMPORT
  const finishedAt = new Date();
  const status = r.cancelled ? "CANCELLED" : r.failed + r.errors > 0 && r.created + r.updated > 0 ? "COMPLETED_WITH_ERRORS" : r.errors > 0 && r.created + r.updated === 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED";
  await adminDb.importSession.update({
    where: { id: session.id },
    data: {
      status,
      step: "REVIEW",
      totalRows: r.total,
      processedRows: r.total,
      createdRows: r.created,
      updatedRows: r.updated,
      skippedRows: r.skipped,
      duplicateRows: r.duplicates,
      failedRows: r.errors,
      errorRows: r.errors,
      finishedAt,
      rollbackDeadline: new Date(finishedAt.getTime() + rollbackWindowMs()),
      summary: {
        ...base,
        result: { created: r.created, updated: r.updated, skipped: r.skipped, duplicates: r.duplicates, errors: r.errors, warnings: r.warnings, newCompanies: r.newCompanies, newContacts: r.newContacts, newTags: r.newTags, truncated: r.truncated },
      } as unknown as Prisma.InputJsonValue,
    },
  });
  await recordAuditEvent({
    organizationId,
    actorMembershipId: importerId,
    action: "data_migration.imported",
    entityType: "ImportSession",
    entityId: session.id,
    metadata: {
      entity: session.entity,
      file: session.fileName,
      policy: session.duplicatePolicy,
      status,
      rows: r.total,
      created: r.created,
      updated: r.updated,
      skipped: r.skipped,
      errors: r.errors,
      newCompanies: r.newCompanies,
      newContacts: r.newContacts,
    },
  });
  // Scores for the new leads and customers follow on the nightly schedule; ask for one now so they are not blank for a day.
  if (r.created + r.updated > 0) {
    await enqueueJobFor({ organizationId, type: "scores.recompute", createdByMembershipId: importerId }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Error report
// ---------------------------------------------------------------------------

/** The issues of a session beside the original row, as CSV, so the person can fix the file and upload it again. */
export async function buildErrorReport(session: ImportSession, phase: "VALIDATE" | "IMPORT" | "ALL" = "ALL"): Promise<Buffer> {
  const organizationId = session.organizationId;
  const issues = await adminDb.importSessionIssue.findMany({
    where: { organizationId, sessionId: session.id, ...(phase === "ALL" ? {} : { phase }), severity: { in: ["ERROR", "WARNING", "DUPLICATE"] } },
    orderBy: [{ rowNumber: "asc" }, { id: "asc" }],
  });
  const headers = ((session.headers ?? []) as string[]).filter((h) => typeof h === "string");
  const wanted = new Set(issues.map((i) => i.rowNumber));
  const originals = new Map<number, Record<string, string>>();
  if (wanted.size > 0 && session.fileId) {
    const bytes = await readFile(session);
    let n = 1;
    for await (const raw of parseCsvRows(Readable.from(bytes))) {
      n += 1;
      if (wanted.has(n)) originals.set(n, raw);
      if (originals.size === wanted.size) break;
    }
  }
  const columns = ["row", "severity", "field", "problem", "existing_record_id", ...headers];
  return Buffer.from(
    stringify(
      issues.map((i) => ({
        row: i.rowNumber,
        severity: i.severity,
        field: i.field ?? "",
        problem: i.message,
        existing_record_id: i.matchedId ?? "",
        ...Object.fromEntries(headers.map((h) => [h, originals.get(i.rowNumber)?.[h] ?? ""])),
      })),
      { header: true, columns },
    ),
  );
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

export interface RollbackResult {
  deleted: number;
  restored: number;
  kept: number;
  keptReasons: Record<string, number>;
}

const DELETE_ORDER: MigrationEntity[] = ["ACTIVITY", "TASK", "DEAL", "LEAD", "CONTACT", "COMPANY"];
const PAGE = 500;

/**
 * Undoes a session: records it created are removed (newest dependencies first), fields it changed are put back. Nothing a person did
 * afterwards is destroyed: a record edited since the import, or one other records now depend on, is kept and counted with its reason.
 */
export async function runRollback(organizationId: string, sessionId: string, actorMembershipId: string): Promise<RollbackResult> {
  const session = await adminDb.importSession.findFirstOrThrow({ where: { id: sessionId, organizationId } });
  const importedUntil = session.finishedAt ?? new Date();
  const result: RollbackResult = { deleted: 0, restored: 0, kept: 0, keptReasons: {} };
  const keep = (reason: string, n = 1) => {
    result.kept += n;
    result.keptReasons[reason] = (result.keptReasons[reason] ?? 0) + n;
  };

  for (const entity of DELETE_ORDER) {
    let cursor: string | undefined;
    for (;;) {
      const rows = await adminDb.importSessionChange.findMany({
        where: { organizationId, sessionId, entity, action: "CREATED", ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: "asc" },
        take: PAGE,
        select: { id: true, recordId: true },
      });
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1]!.id;
      const ids = rows.map((r) => r.recordId);
      await withOrgContext(
        organizationId,
        async (tx) => {
          const delegate = delegateFor(tx, entity);
          const present = (await delegate.findMany({ where: { id: { in: ids }, organizationId }, select: { id: true, ...(entity === "ACTIVITY" ? {} : { updatedAt: true }) } })) as { id: string; updatedAt?: Date }[];
          const blocked = new Map<string, string>();
          for (const p of present) {
            // Allow a second for the write itself; later than that is somebody's edit.
            if (p.updatedAt && p.updatedAt.getTime() > importedUntil.getTime() + 1000) blocked.set(p.id, "changed after the import");
          }
          const live = present.filter((p) => !blocked.has(p.id)).map((p) => p.id);
          for (const [id, why] of await dependentsOutsideSession(tx, entity, live, session.id)) blocked.set(id, why);
          const deletable = live.filter((id) => !blocked.has(id));
          if (deletable.length > 0) {
            try {
              result.deleted += (await delegate.deleteMany({ where: { id: { in: deletable }, organizationId } })).count;
            } catch {
              // Something still refers to a record in this page: remove them one by one and keep the ones that refuse.
              for (const id of deletable) {
                try {
                  await tx.$executeRaw`SAVEPOINT rb`;
                  result.deleted += (await delegate.deleteMany({ where: { id, organizationId } })).count;
                  await tx.$executeRaw`RELEASE SAVEPOINT rb`;
                } catch {
                  await tx.$executeRaw`ROLLBACK TO SAVEPOINT rb`;
                  blocked.set(id, "other records depend on it");
                }
              }
            }
          }
          for (const why of blocked.values()) keep(why);
          // Records that were already gone count as nothing.
        },
        { timeoutMs: WRITE_TIMEOUT_MS },
      );
    }
  }

  // Fields changed by an UPDATE policy go back, unless someone changed them again since.
  let cursor: string | undefined;
  for (;;) {
    const rows = await adminDb.importSessionChange.findMany({
      where: { organizationId, sessionId, action: "UPDATED", ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: PAGE,
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1]!.id;
    await withOrgContext(
      organizationId,
      async (tx) => {
        for (const change of rows) {
          const delegate = delegateFor(tx, change.entity as MigrationEntity);
          const current = (await delegate.findMany({ where: { id: change.recordId, organizationId } }))[0];
          if (!current) continue;
          const { before, after } = change.previous as { before: Record<string, unknown>; after: Record<string, unknown> };
          const restore: Record<string, unknown> = {};
          for (const [field, was] of Object.entries(before)) {
            if (jsonish(current[field]) === jsonish(after[field])) restore[field] = was;
            else keep("a field was changed again after the import");
          }
          if (Object.keys(restore).length > 0) {
            await delegate.update({ where: { id: change.recordId }, data: restore });
            result.restored += 1;
          }
        }
      },
      { timeoutMs: WRITE_TIMEOUT_MS },
    );
  }

  await adminDb.importSession.update({
    where: { id: session.id },
    data: {
      status: "ROLLED_BACK",
      step: "REVIEW",
      rolledBackAt: new Date(),
      rolledBackByMembershipId: actorMembershipId,
      summary: { ...((session.summary ?? {}) as object), rollback: result } as unknown as Prisma.InputJsonValue,
    },
  });
  await recordAuditEvent({
    organizationId,
    actorMembershipId,
    action: "data_migration.rolled_back",
    entityType: "ImportSession",
    entityId: session.id,
    metadata: { entity: session.entity, ...result } as unknown as Prisma.InputJsonValue,
  });
  return result;
}

/** Which of these records have something attached that did not come from this session. Maps record id to why. */
async function dependentsOutsideSession(tx: OrgScopedClient, entity: MigrationEntity, ids: string[], sessionId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const notFromSession = { OR: [{ importSessionId: null }, { importSessionId: { not: sessionId } }] };
  const mark = (rows: (string | null)[], why: string) => {
    for (const id of rows) if (id && !out.has(id)) out.set(id, why);
  };
  if (entity === "CONTACT") {
    mark((await tx.activity.findMany({ where: { contactId: { in: ids }, ...notFromSession }, select: { contactId: true } })).map((r) => r.contactId), "it has activity logged since the import");
    mark((await tx.task.findMany({ where: { contactId: { in: ids }, ...notFromSession }, select: { contactId: true } })).map((r) => r.contactId), "it has tasks added since the import");
    mark((await tx.communication.findMany({ where: { contactId: { in: ids } }, select: { contactId: true } })).map((r) => r.contactId), "it has conversations");
    mark((await tx.lead.findMany({ where: { contactId: { in: ids }, ...notFromSession }, select: { contactId: true } })).map((r) => r.contactId), "other leads use it");
    mark((await tx.deal.findMany({ where: { primaryContactId: { in: ids }, ...notFromSession }, select: { primaryContactId: true } })).map((r) => r.primaryContactId), "other deals use it");
  } else if (entity === "COMPANY") {
    mark((await tx.contact.findMany({ where: { companyId: { in: ids }, ...notFromSession }, select: { companyId: true } })).map((r) => r.companyId), "it has contacts that were not imported");
    mark((await tx.lead.findMany({ where: { companyId: { in: ids }, ...notFromSession }, select: { companyId: true } })).map((r) => r.companyId), "it has leads that were not imported");
    mark((await tx.deal.findMany({ where: { companyId: { in: ids }, ...notFromSession }, select: { companyId: true } })).map((r) => r.companyId), "it has deals that were not imported");
    mark((await tx.task.findMany({ where: { companyId: { in: ids }, ...notFromSession }, select: { companyId: true } })).map((r) => r.companyId), "it has tasks added since the import");
    mark((await tx.activity.findMany({ where: { companyId: { in: ids }, ...notFromSession }, select: { companyId: true } })).map((r) => r.companyId), "it has activity logged since the import");
    mark((await tx.communication.findMany({ where: { companyId: { in: ids } }, select: { companyId: true } })).map((r) => r.companyId), "it has conversations");
    mark((await tx.invoice.findMany({ where: { companyId: { in: ids } }, select: { companyId: true } })).map((r) => r.companyId), "it has invoices");
    mark((await tx.recurringService.findMany({ where: { companyId: { in: ids } }, select: { companyId: true } })).map((r) => r.companyId), "it has recurring services");
  } else if (entity === "LEAD") {
    mark((await tx.activity.findMany({ where: { leadId: { in: ids }, ...notFromSession }, select: { leadId: true } })).map((r) => r.leadId), "it has activity logged since the import");
    mark((await tx.task.findMany({ where: { leadId: { in: ids }, ...notFromSession }, select: { leadId: true } })).map((r) => r.leadId), "it has tasks added since the import");
    mark((await tx.deal.findMany({ where: { leadId: { in: ids } }, select: { leadId: true } })).map((r) => r.leadId), "it was converted to a deal");
  } else if (entity === "DEAL") {
    mark((await tx.invoice.findMany({ where: { dealId: { in: ids } }, select: { dealId: true } })).map((r) => r.dealId), "it has invoices");
    mark((await tx.activity.findMany({ where: { dealId: { in: ids }, ...notFromSession }, select: { dealId: true } })).map((r) => r.dealId), "it has activity logged since the import");
    mark((await tx.dealHandoff.findMany({ where: { dealId: { in: ids } }, select: { dealId: true } })).map((r) => r.dealId), "it was handed off to Delivery");
  }
  return out;
}
