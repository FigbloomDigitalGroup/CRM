import { Readable } from "node:stream";
import { stringifyCsv as stringify } from "../lib/csv";
import type { DataRun } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { enqueueJobFor } from "../jobs/runner";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import { recordAuditEvent } from "../repositories/auditEvents";
import { resolveActiveMembership } from "../repositories/memberships";
import {
  TERMINAL_STATUSES,
  createDataRun,
  getDataRun,
  isCancelRequested,
  listDataRuns,
  requestCancel,
  updateDataRun,
} from "../repositories/dataRuns";
import { getStorageDriver } from "../storage";
import { FILE_POLICIES } from "../storage/policy";
import { countCompanies } from "./companyService";
import { countContacts } from "./contactService";
import { countDeals } from "./dealService";
import { countLeads } from "./leadService";
import {
  assertBulkExportAllowed,
  exportCompaniesCsv,
  exportContactsCsv,
  exportDealsCsv,
  exportLeadsCsv,
} from "./exportService";
import { storeGeneratedFile, issueDownloadLinkAuthorised } from "./fileService";
import {
  assertCsvRequestSize,
  importCompanies,
  importContacts,
  importDeals,
  importLeads,
  type DuplicateStrategy,
  type ImportSummary,
} from "./importService";

/**
 * Imports and exports as background runs (FIG-1034, B2.05, screen L3).
 *
 * A person starts a run and gets its id at once; the work happens in a job
 * (`data.import`, `data.export`) so a 5,000-row file never ties up a request.
 * The run row shows status and progress, can be cancelled, and ends with an error
 * report (imports) or the CSV (exports), both stored through the file service and
 * handed out as short-lived signed links.
 *
 *   see / cancel / download : the person who started it, or Management (`configuration.manage`).
 *   import  : the entity's import permission. Good rows are kept when others fail.
 *   export  : the entity's export permission; above 500 rows also `export.bulk` (Management) until approvals arrive.
 *             Exports go through the same list services as the screens, so masking and scope are identical.
 *   audit   : every import and export records its row counts.
 */

export type DataEntity = "LEAD" | "CONTACT" | "COMPANY" | "DEAL";
export const IMPORT_JOB = "data.import";
export const EXPORT_JOB = "data.export";

const IMPORT_PERMISSION: Record<DataEntity, string> = {
  LEAD: "leads.import",
  CONTACT: "contacts.import",
  COMPANY: "companies.import",
  DEAL: "deals.create",
};
const EXPORT_PERMISSION: Record<DataEntity, string> = {
  LEAD: "leads.export",
  CONTACT: "contacts.export",
  COMPANY: "companies.export",
  DEAL: "deals.export",
};

/** Filters an export may carry; anything else is refused rather than silently dropped. */
export const EXPORT_FILTER_KEYS = [
  "query",
  "ownerMembershipId",
  "leadStatusId",
  "leadSourceId",
  "pipelineStageId",
  "lifecycleStateId",
  "companyId",
  "tagIds",
  "includeArchived",
  "archivedOnly",
] as const;

function present(run: DataRun) {
  return {
    id: run.id,
    kind: run.kind,
    entity: run.entity,
    status: run.status,
    done: TERMINAL_STATUSES.includes(run.status),
    totalRows: run.totalRows,
    processedRows: run.processedRows,
    createdRows: run.createdRows,
    duplicateRows: run.duplicateRows,
    alreadyConvertedRows: run.alreadyConvertedRows,
    failedRows: run.failedRows,
    truncated: run.truncated,
    cancelRequested: run.cancelRequested,
    failureMessage: run.failureMessage,
    hasResultFile: run.resultFileId !== null,
    hasErrorReport: run.errorFileId !== null,
    createdByMembershipId: run.createdByMembershipId,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    createdAt: run.createdAt,
  };
}

function canSee(ctx: AuthContext, run: DataRun): boolean {
  return run.createdByMembershipId === ctx.membershipId || hasPermission(ctx, "configuration.manage");
}

async function loadVisible(ctx: AuthContext, runId: string): Promise<DataRun> {
  const run = await getDataRun(ctx.organizationId, runId);
  if (!run || !canSee(ctx, run)) throw new NotFoundError("Run", runId);
  return run;
}

// ---------------------------------------------------------------------------
// Starting
// ---------------------------------------------------------------------------

export interface StartImportInput {
  entity: DataEntity;
  fileName: string;
  csv: Buffer;
  mapping: Record<string, string | undefined>;
  duplicateStrategy: DuplicateStrategy;
}

export async function startImport(ctx: AuthContext, input: StartImportInput) {
  requirePermission(ctx, IMPORT_PERMISSION[input.entity]);
  assertCsvRequestSize(input.csv.length);
  if (input.csv.length === 0) throw new ValidationError("The file is empty.", [{ path: "file", message: "Choose a CSV file with rows." }]);

  const file = await storeGeneratedFile({
    organizationId: ctx.organizationId,
    ownerMembershipId: ctx.membershipId,
    purpose: "IMPORT",
    name: input.fileName.toLowerCase().endsWith(".csv") ? input.fileName : `${input.fileName}.csv`,
    mimeType: "text/csv",
    data: input.csv,
  });
  const run = await createDataRun({
    organizationId: ctx.organizationId,
    kind: "IMPORT",
    entity: input.entity,
    createdByMembershipId: ctx.membershipId,
    sourceFileId: file.id,
    params: { mapping: input.mapping, duplicateStrategy: input.duplicateStrategy },
  });
  const job = await enqueueJobFor({
    organizationId: ctx.organizationId,
    type: IMPORT_JOB,
    payload: { runId: run.id },
    createdByMembershipId: ctx.membershipId,
  });
  await updateDataRun(ctx.organizationId, run.id, { jobId: job.id });
  return present({ ...run, jobId: job.id });
}

export async function countForExport(ctx: AuthContext, entity: DataEntity, filters: Record<string, unknown>): Promise<number> {
  switch (entity) {
    case "COMPANY":
      return countCompanies(ctx, filters as never);
    case "CONTACT":
      return countContacts(ctx, filters as never);
    case "LEAD":
      return countLeads(ctx, filters as never);
    case "DEAL":
      return countDeals(ctx, filters as never);
  }
}

export async function startExport(ctx: AuthContext, input: { entity: DataEntity; filters?: Record<string, unknown>; approvalId?: string }) {
  requirePermission(ctx, EXPORT_PERMISSION[input.entity]);
  const filters = input.filters ?? {};
  const unknown = Object.keys(filters).filter((k) => !(EXPORT_FILTER_KEYS as readonly string[]).includes(k));
  if (unknown.length > 0) {
    throw new ValidationError("Some export filters are not recognised.", unknown.map((k) => ({ path: `filters.${k}`, message: "Unknown filter." })));
  }
  // Refuse a large export up front, rather than after it was queued.
  await assertBulkExportAllowed(ctx, await countForExport(ctx, input.entity, filters), { approvalId: input.approvalId, entity: input.entity });

  const run = await createDataRun({
    organizationId: ctx.organizationId,
    kind: "EXPORT",
    entity: input.entity,
    createdByMembershipId: ctx.membershipId,
    params: { filters } as never,
  });
  const job = await enqueueJobFor({
    organizationId: ctx.organizationId,
    type: EXPORT_JOB,
    payload: { runId: run.id },
    createdByMembershipId: ctx.membershipId,
  });
  await updateDataRun(ctx.organizationId, run.id, { jobId: job.id });
  return present({ ...run, jobId: job.id });
}

// ---------------------------------------------------------------------------
// Reading, cancelling, downloading
// ---------------------------------------------------------------------------

export async function listRuns(ctx: AuthContext, query: { kind?: "IMPORT" | "EXPORT"; paging?: PageRequest } = {}) {
  const paging = resolvePaging(query.paging ?? {});
  const { rows, total } = await listDataRuns(ctx.organizationId, {
    kind: query.kind,
    createdByMembershipId: hasPermission(ctx, "configuration.manage") ? undefined : ctx.membershipId,
    take: paging.take,
    skip: paging.skip,
  });
  return buildPage(rows.map(present), total, paging);
}

export async function getRun(ctx: AuthContext, runId: string) {
  return present(await loadVisible(ctx, runId));
}

/** Asks the job to stop at its next check. Rows already imported stay. A run that is over is reported as it is. */
export async function cancelRun(ctx: AuthContext, runId: string) {
  const run = await loadVisible(ctx, runId);
  if (TERMINAL_STATUSES.includes(run.status)) return present(run);
  await requestCancel(ctx.organizationId, runId);
  if (run.status === "QUEUED") {
    // Not started yet: nothing to stop, so it ends here and the job finds it over.
    await updateDataRun(ctx.organizationId, runId, { status: "CANCELLED", finishedAt: new Date() });
  }
  return present((await getDataRun(ctx.organizationId, runId))!);
}

export async function getRunDownload(ctx: AuthContext, runId: string, which: "result" | "errors") {
  const run = await loadVisible(ctx, runId);
  const fileId = which === "result" ? run.resultFileId : run.errorFileId;
  if (!fileId) throw new NotFoundError("File", `${runId}/${which}`);
  const file = await adminDb.file.findFirst({ where: { id: fileId, organizationId: ctx.organizationId } });
  if (!file) throw new NotFoundError("File", fileId);
  return issueDownloadLinkAuthorised(file);
}

// ---------------------------------------------------------------------------
// The jobs
// ---------------------------------------------------------------------------

async function contextFor(run: DataRun): Promise<AuthContext | null> {
  if (!run.createdByMembershipId) return null;
  const membership = await adminDb.membership.findFirst({
    where: { id: run.createdByMembershipId, organizationId: run.organizationId },
    select: { userId: true },
  });
  return membership ? resolveActiveMembership(membership.userId, run.organizationId) : null;
}

async function fail(run: DataRun, message: string) {
  await updateDataRun(run.organizationId, run.id, { status: "FAILED", failureMessage: message.slice(0, 500), finishedAt: new Date() });
}

function errorReportCsv(errors: ImportSummary["errors"]): Buffer {
  return Buffer.from(
    stringify(
      errors.map((e) => ({ row: e.row, outcome: e.outcome ?? "failed", reason: e.reason, matchedRecordId: e.matchedId ?? "" })),
      { header: true, columns: ["row", "outcome", "reason", "matchedRecordId"] },
    ),
  );
}

/** Runs one queued import. Never throws for a problem with the file or the rows: the run records it. */
export async function runImportJob(runId: string, organizationId: string): Promise<void> {
  const run = await getDataRun(organizationId, runId);
  if (!run || run.kind !== "IMPORT" || TERMINAL_STATUSES.includes(run.status)) return;
  await updateDataRun(organizationId, runId, { status: "RUNNING", startedAt: new Date() });

  try {
    const ctx = await contextFor(run);
    if (!ctx) return await fail(run, "The person who started this import is no longer an active member.");
    const source = run.sourceFileId ? await adminDb.file.findFirst({ where: { id: run.sourceFileId, organizationId } }) : null;
    if (!source || source.status !== "READY") return await fail(run, "The uploaded file is no longer available.");
    const bytes = await getStorageDriver().getObject(source.storageKey, FILE_POLICIES.IMPORT.maxBytes);

    const params = run.params as { mapping?: Record<string, string | undefined>; duplicateStrategy?: DuplicateStrategy };
    const input = {
      fileStream: Readable.from(bytes),
      mapping: params.mapping ?? {},
      duplicateStrategy: params.duplicateStrategy ?? "skip",
      hooks: {
        maxErrors: 5000,
        isCancelled: () => isCancelRequested(organizationId, runId),
        onProgress: async (s: ImportSummary) => {
          await updateDataRun(organizationId, runId, {
            totalRows: s.totalRows,
            processedRows: s.created + s.duplicatesSkipped + s.alreadyConverted + s.failed,
            createdRows: s.created,
            duplicateRows: s.duplicatesSkipped,
            alreadyConvertedRows: s.alreadyConverted,
            failedRows: s.failed,
          });
        },
      },
    };
    const summary =
      run.entity === "COMPANY"
        ? await importCompanies(ctx, input)
        : run.entity === "CONTACT"
          ? await importContacts(ctx, input)
          : run.entity === "DEAL"
            ? await importDeals(ctx, input)
            : await importLeads(ctx, input);

    let errorFileId: string | undefined;
    if (summary.errors.length > 0) {
      const report = await storeGeneratedFile({
        organizationId,
        ownerMembershipId: run.createdByMembershipId,
        purpose: "EXPORT",
        name: `import-report-${run.id.slice(0, 8)}.csv`,
        mimeType: "text/csv",
        data: errorReportCsv(summary.errors),
      });
      errorFileId = report.id;
    }
    await updateDataRun(organizationId, runId, {
      status: summary.cancelled ? "CANCELLED" : summary.failed > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
      totalRows: summary.totalRows,
      processedRows: summary.created + summary.duplicatesSkipped + summary.alreadyConverted + summary.failed,
      createdRows: summary.created,
      duplicateRows: summary.duplicatesSkipped,
      alreadyConvertedRows: summary.alreadyConverted,
      failedRows: summary.failed,
      truncated: summary.truncated,
      errorFileId,
      finishedAt: new Date(),
    });
  } catch (err) {
    await fail(run, err instanceof Error ? err.message : "The import stopped unexpectedly.");
  }
}

/** Runs one queued export: the same list services as the screens, so masking and scope are identical; the CSV goes to the file service. */
export async function runExportJob(runId: string, organizationId: string): Promise<void> {
  const run = await getDataRun(organizationId, runId);
  if (!run || run.kind !== "EXPORT" || TERMINAL_STATUSES.includes(run.status)) return;
  await updateDataRun(organizationId, runId, { status: "RUNNING", startedAt: new Date() });

  try {
    const ctx = await contextFor(run);
    if (!ctx) return await fail(run, "The person who started this export is no longer an active member.");
    const filters = ((run.params as { filters?: Record<string, unknown> }).filters ?? {}) as never;
    const csv =
      run.entity === "COMPANY"
        ? await exportCompaniesCsv(ctx, filters)
        : run.entity === "CONTACT"
          ? await exportContactsCsv(ctx, filters)
          : run.entity === "LEAD"
            ? await exportLeadsCsv(ctx, filters)
            : await exportDealsCsv(ctx, filters);

    const chunks: string[] = [stringify([], { header: true, columns: csv.columns })];
    let rows = 0;
    for await (const row of csv.rows) {
      chunks.push(stringify([row], { columns: csv.columns }));
      rows += 1;
      if (rows % 500 === 0) {
        await updateDataRun(organizationId, runId, { totalRows: rows, processedRows: rows });
        if (await isCancelRequested(organizationId, runId)) {
          await updateDataRun(organizationId, runId, { status: "CANCELLED", finishedAt: new Date() });
          return;
        }
      }
    }
    const file = await storeGeneratedFile({
      organizationId,
      ownerMembershipId: run.createdByMembershipId,
      purpose: "EXPORT",
      name: `${run.entity.toLowerCase()}s-${new Date().toISOString().slice(0, 10)}.csv`,
      mimeType: "text/csv",
      data: Buffer.from(chunks.join("")),
    });
    await updateDataRun(organizationId, runId, {
      status: "COMPLETED",
      totalRows: rows,
      processedRows: rows,
      createdRows: rows,
      resultFileId: file.id,
      finishedAt: new Date(),
    });
    await recordAuditEvent({
      organizationId,
      actorMembershipId: run.createdByMembershipId ?? undefined,
      action: "data.export.completed",
      entityType: run.entity === "DEAL" ? "Deal" : run.entity === "LEAD" ? "Lead" : run.entity === "CONTACT" ? "Contact" : "Company",
      metadata: { runId, rows },
    });
  } catch (err) {
    await fail(run, err instanceof Error ? err.message : "The export stopped unexpectedly.");
  }
}
