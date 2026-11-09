import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Prisma, type PlatformDataRequest } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import type { PlatformContext } from "../auth/platformSession";
import { adminDb } from "../db/adminClient";
import { getPlatformDb } from "../db/platformClient";
import { ORG_EXPORT_JOB } from "../jobs/offboardingJobs";
import { enqueueJobFor } from "../jobs/runner";
import { recordAuditEvent } from "../repositories/auditEvents";
import { getStorageDriver } from "../storage";
import { buildStorageKey } from "../storage/keys";
import { EXPORTED_TABLES, EXPORT_TABLE_FILTERS } from "./organisationExportTables";
import { eraseMemberChat } from "./chatPrivacyService";
import { cleanReason, transitionOrganization } from "./organizationLifecycleService";
import { recordPlatformAudit } from "./platformAuditService";

/**
 * Data requests and offboarding (FIG-1141, B6.09; screens PL6 and OS6).
 *
 *   intake        an organisation's Management asks for all of its data (EXPORT) or to be deleted (DELETE).
 *                 One open request per organisation and kind. Nothing happens to any data at this point.
 *   approval      EXPORT needs one platform approver, DELETE needs two different ones (a database rule: one decision per person).
 *                 Anyone may reject, with a reason, which closes the request. Approving a DELETE starts the organisation's offboarding.
 *   packaging     once approved, a background job (`platform.org_export`, allowed while offboarding) writes the organisation's data
 *                 to one gzip file in the organisation's own storage prefix. Only the organisation's Management can fetch it, through
 *                 a short-lived signed link, until the download window ends; then the file is purged. Platform staff never download it.
 *   waiting       a deletion waits `retentionDays` (30, never under 7) after the second approval. The organisation can still be
 *                 reactivated by cancelling the request, with a reason, until deletion runs.
 *   deletion      a separate, deliberate call that re-checks everything (two distinct approvers, waiting period over, export packaged,
 *                 organisation offboarding, the slug typed back) and then removes the data in one transaction.
 *   certificate   the same transaction stores a deletion certificate (what was removed, who approved, when, the export's checksum, a hash
 *                 of the content) and audits it. The organisation row stays as a tombstone (status OFFBOARDED) so its slug is never reused.
 */

export const DEFAULT_RETENTION_DAYS = 30;
export const MIN_RETENTION_DAYS = 7;
export const EXPORT_LINK_DAYS = 14;
export const APPROVALS_REQUIRED = { EXPORT: 1, DELETE: 2 } as const;
const DAY_MS = 86_400_000;
const MAX_EXPORT_BYTES = 200 * 1024 * 1024;
const PERMISSION = "security.manage";
const FRESH_RESET_MS = DAY_MS;

/** A credential reset or recovery within 24 hours before (or any time after) the approval makes the approval unusable. */
function isFreshlyReset(resetAt: Date | null | undefined, at: Date): boolean {
  return !!resetAt && resetAt.getTime() > at.getTime() - FRESH_RESET_MS;
}

const EXPORT_REDACTED_COLUMN = /(hash|secret|token|password|verifier|p256dh|_enc$|api_key)/i;

export function retentionDays(env: Record<string, string | undefined> = process.env): number {
  const asked = Number(env.PLATFORM_DELETION_WAIT_DAYS);
  return Number.isFinite(asked) && asked >= MIN_RETENTION_DAYS ? Math.floor(asked) : DEFAULT_RETENTION_DAYS;
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

type RequestWithApprovals = PlatformDataRequest & { approvals?: { approverIdentityId: string; approverLabel: string; decision: string; comment: string | null; decidedAt: Date }[] };

function present(r: RequestWithApprovals) {
  const approvals = (r.approvals ?? []).slice().sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime());
  return {
    id: r.id,
    organizationId: r.organizationId,
    organizationSlug: r.organizationSlug,
    organizationName: r.organizationName,
    kind: r.kind as "EXPORT" | "DELETE",
    status: r.status as "SUBMITTED" | "APPROVED" | "COMPLETED" | "REJECTED" | "CANCELLED",
    note: r.note,
    requestedBy: r.requestedByLabel,
    submittedAt: r.submittedAt.toISOString(),
    approvalsRequired: r.approvalsRequired,
    approvals: approvals.map((a) => ({ approverIdentityId: a.approverIdentityId, approver: a.approverLabel, decision: a.decision, comment: a.comment, decidedAt: a.decidedAt.toISOString() })),
    approvedAt: r.approvedAt?.toISOString() ?? null,
    retentionDays: r.retentionDays,
    deleteAfter: r.deleteAfter?.toISOString() ?? null,
    export: {
      status: r.exportStatus as "NONE" | "PACKAGING" | "READY" | "FAILED" | "EXPIRED",
      fileName: r.exportFileName,
      sizeBytes: r.exportSizeBytes,
      checksumSha256: r.exportChecksumSha256,
      tableCounts: (r.exportTableCounts ?? null) as Record<string, number> | null,
      readyAt: r.exportReadyAt?.toISOString() ?? null,
      expiresAt: r.exportExpiresAt?.toISOString() ?? null,
      error: r.exportError,
    },
    closedAt: r.closedAt?.toISOString() ?? null,
    closedReason: r.closedReason,
  };
}

// ---------------------------------------------------------------------------
// Intake and the organisation's own view (OS6)
// ---------------------------------------------------------------------------

/** What the organisation sees: a status it understands, the export window, nothing about who approved. */
function presentForOrganisation(r: PlatformDataRequest) {
  return {
    id: r.id,
    kind: r.kind as "EXPORT" | "DELETE",
    status: r.status === "SUBMITTED" ? "SUBMITTED_TO_PLATFORM" : r.status,
    note: r.note,
    requestedByMembershipId: r.requestedByMembershipId as string,
    submittedAt: r.submittedAt.toISOString(),
    exportStatus: r.exportStatus,
    exportExpiresAt: r.exportStatus === "READY" ? r.exportExpiresAt?.toISOString() ?? null : null,
    deleteAfter: r.kind === "DELETE" && r.status === "APPROVED" ? r.deleteAfter?.toISOString() ?? null : null,
  };
}

export async function listOrganisationRequests(organizationId: string) {
  const rows = await adminDb.platformDataRequest.findMany({ where: { organizationId }, orderBy: { submittedAt: "asc" } });
  return rows.map(presentForOrganisation);
}

export async function submitOrganisationRequest(ctx: AuthContext, input: { kind: string; note?: string }, now = new Date()) {
  requirePermission(ctx, PERMISSION);
  if (input.kind !== "EXPORT" && input.kind !== "DELETE") {
    throw new ValidationError("Choose EXPORT or DELETE.", [{ path: "kind", message: "EXPORT or DELETE." }]);
  }
  const kind = input.kind;
  const open = await adminDb.platformDataRequest.findFirst({ where: { organizationId: ctx.organizationId, kind, status: { in: ["SUBMITTED", "APPROVED"] } } });
  if (open) {
    throw new ValidationError(`A request to ${kind === "EXPORT" ? "export" : "delete"} the organisation is already with the platform team.`, [{ path: "kind", message: "Already submitted.", code: "ALREADY_SUBMITTED" }]);
  }
  const [org, member] = await Promise.all([
    adminDb.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { slug: true, name: true } }),
    adminDb.membership.findUnique({ where: { id: ctx.membershipId }, include: { user: { select: { name: true } } } }),
  ]);
  let row: PlatformDataRequest;
  try {
    row = await adminDb.platformDataRequest.create({
      data: {
        organizationId: ctx.organizationId,
        organizationSlug: org.slug,
        organizationName: org.name,
        kind,
        note: input.note?.trim().slice(0, 500) || null,
        requestedByMembershipId: ctx.membershipId,
        requestedByLabel: member?.user.name ?? "Management",
        submittedAt: now,
        approvalsRequired: APPROVALS_REQUIRED[kind],
        retentionDays: retentionDays(),
      },
    });
  } catch (err) {
    // Two requests at the same moment: the partial unique index lets one win.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ValidationError(`A request to ${kind === "EXPORT" ? "export" : "delete"} the organisation is already with the platform team.`, [{ path: "kind", message: "Already submitted.", code: "ALREADY_SUBMITTED" }]);
    }
    throw err;
  }
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "organization.data_request_submitted", entityType: "Organization", entityId: ctx.organizationId, metadata: { kind, requestId: row.id } });
  await recordPlatformAudit(adminDb, {
    actorIdentityId: null,
    actorLabel: `Organisation ${org.slug}`,
    action: "data_request.submitted",
    targetType: "DataRequest",
    targetId: row.id,
    organizationId: ctx.organizationId,
    organizationSlug: org.slug,
    metadata: { kind },
  });
  return presentForOrganisation(row);
}

/** A short-lived signed link to the packaged export, for the organisation's own Management, inside the download window only. */
export async function getOrganisationExportDownload(ctx: AuthContext, requestId: string, now = new Date()) {
  requirePermission(ctx, PERMISSION);
  const row = await adminDb.platformDataRequest.findFirst({ where: { id: requestId, organizationId: ctx.organizationId } });
  if (!row) throw new NotFoundError("Data request", requestId);
  if (row.exportStatus !== "READY" || !row.exportStorageKey || !row.exportExpiresAt) {
    throw new ValidationError(row.exportStatus === "PACKAGING" ? "The export is still being prepared." : row.exportStatus === "EXPIRED" ? "The download window has ended." : "There is no export to download for this request.", [{ path: "requestId", message: "No export available.", code: "EXPORT_UNAVAILABLE" }]);
  }
  if (row.exportExpiresAt.getTime() <= now.getTime()) {
    throw new ValidationError("The download window has ended.", [{ path: "requestId", message: "No export available.", code: "EXPORT_EXPIRED" }]);
  }
  const link = await getStorageDriver().signDownload(row.exportStorageKey, {
    expiresInSeconds: 60,
    fileName: row.exportFileName ?? "organisation-export.json.gz",
    contentType: "application/gzip",
    disposition: "attachment",
  });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "organization.export_downloaded", entityType: "Organization", entityId: ctx.organizationId, metadata: { requestId } });
  await recordPlatformAudit(adminDb, { actorIdentityId: null, actorLabel: `Organisation ${row.organizationSlug}`, action: "data_request.export_downloaded", targetType: "DataRequest", targetId: row.id, organizationId: row.organizationId, organizationSlug: row.organizationSlug });
  return { download: { url: link.url, expiresAt: link.expiresAt }, fileName: row.exportFileName, sizeBytes: row.exportSizeBytes, checksumSha256: row.exportChecksumSha256, availableUntil: row.exportExpiresAt.toISOString() };
}

// ---------------------------------------------------------------------------
// Platform queue (PL6)
// ---------------------------------------------------------------------------

export const REQUEST_STATUSES = ["SUBMITTED", "APPROVED", "COMPLETED", "REJECTED", "CANCELLED"] as const;

export async function listDataRequests(query: { status?: string; kind?: string; organizationId?: string; page?: number; pageSize?: number } = {}) {
  if (query.status && !(REQUEST_STATUSES as readonly string[]).includes(query.status)) {
    throw new ValidationError("Unknown status.", [{ path: "status", message: `Use one of ${REQUEST_STATUSES.join(", ")}.` }]);
  }
  if (query.kind && query.kind !== "EXPORT" && query.kind !== "DELETE") {
    throw new ValidationError("Unknown kind.", [{ path: "kind", message: "EXPORT or DELETE." }]);
  }
  const pageSize = Math.min(Math.max(Math.floor(query.pageSize ?? 25), 1), 100);
  const page = Math.max(Math.floor(query.page ?? 1), 1);
  const where: Prisma.PlatformDataRequestWhereInput = { status: query.status, kind: query.kind, organizationId: query.organizationId };
  const db = getPlatformDb();
  const [rows, total] = await Promise.all([
    db.platformDataRequest.findMany({ where, include: { approvals: true }, orderBy: [{ submittedAt: "desc" }, { id: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
    db.platformDataRequest.count({ where }),
  ]);
  return { items: rows.map(present), page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getDataRequest(id: string) {
  const row = await getPlatformDb().platformDataRequest.findUnique({ where: { id }, include: { approvals: true, certificate: { select: { id: true, issuedAt: true, contentSha256: true } } } });
  if (!row) throw new NotFoundError("Data request", id);
  return { ...present(row), certificate: row.certificate ? { id: row.certificate.id, issuedAt: row.certificate.issuedAt.toISOString(), contentSha256: row.certificate.contentSha256 } : null };
}

type Actor = Pick<PlatformContext, "identityId" | "email">;

/**
 * Records one platform admin's decision. A person decides once (database rule), so a DELETE needs two people.
 * The decision that reaches the required count approves the request: a DELETE starts the organisation's offboarding and sets the
 * waiting period; every approved request queues its export. A rejection closes the request at once and needs a reason.
 */
export async function decideDataRequest(
  actor: Actor,
  requestId: string,
  input: { decision: string; comment?: string },
  options: { now?: Date; requestId?: string | null } = {},
) {
  const now = options.now ?? new Date();
  if (input.decision !== "APPROVE" && input.decision !== "REJECT") {
    throw new ValidationError("Decide APPROVE or REJECT.", [{ path: "decision", message: "APPROVE or REJECT." }]);
  }
  const comment = input.decision === "REJECT" ? cleanReason(input.comment) : input.comment?.trim().slice(0, 500) || null;

  const outcome = await getPlatformDb().$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM platform_data_requests WHERE id = ${requestId} FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundError("Data request", requestId);
    const request = await tx.platformDataRequest.findUniqueOrThrow({ where: { id: requestId }, include: { approvals: true } });
    if (request.status !== "SUBMITTED") {
      throw new ValidationError(`This request is already ${request.status.toLowerCase()}.`, [{ path: "status", message: "No longer waiting for a decision.", code: "NOT_PENDING" }]);
    }
    if (request.approvals.some((a) => a.approverIdentityId === actor.identityId)) {
      throw new ValidationError("You have already decided on this request. A different person has to decide next.", [{ path: "decision", message: "One decision per person.", code: "ALREADY_DECIDED" }]);
    }
    if (input.decision === "APPROVE" && request.kind === "DELETE") {
      const me = await tx.platformIdentity.findUnique({ where: { id: actor.identityId }, select: { credentialsResetAt: true } });
      if (isFreshlyReset(me?.credentialsResetAt, now)) {
        throw new ValidationError("Your password or two-step sign-in was reset in the last 24 hours. Approving a deletion has to wait until that has passed.", [{ path: "decision", message: "Credentials reset within 24 hours.", code: "CREDENTIALS_RECENTLY_RESET" }]);
      }
    }
    await tx.platformDataRequestApproval.create({
      data: { requestId, approverIdentityId: actor.identityId, approverLabel: actor.email, decision: input.decision, comment, decidedAt: now },
    });

    if (input.decision === "REJECT") {
      await tx.platformDataRequest.update({ where: { id: requestId }, data: { status: "REJECTED", closedAt: now, closedReason: comment, updatedAt: now } });
      await recordPlatformAudit(tx, { actorIdentityId: actor.identityId, actorLabel: actor.email, action: "data_request.rejected", targetType: "DataRequest", targetId: requestId, organizationId: request.organizationId, organizationSlug: request.organizationSlug, reason: comment, metadata: { kind: request.kind }, requestId: options.requestId ?? null });
      return { status: "REJECTED" as const, startExport: false };
    }

    const approvals = request.approvals.filter((a) => a.decision === "APPROVE").length + 1;
    if (approvals < request.approvalsRequired) {
      await recordPlatformAudit(tx, { actorIdentityId: actor.identityId, actorLabel: actor.email, action: "data_request.approval_recorded", targetType: "DataRequest", targetId: requestId, organizationId: request.organizationId, organizationSlug: request.organizationSlug, reason: comment, metadata: { kind: request.kind, approvals, required: request.approvalsRequired }, requestId: options.requestId ?? null });
      return { status: "SUBMITTED" as const, startExport: false };
    }

    // The last required approval. A DELETE starts the organisation's offboarding first: if that cannot happen, nothing is approved.
    let previous: string | null = null;
    if (request.kind === "DELETE") {
      const org = await adminDb.organization.findUnique({ where: { id: request.organizationId }, select: { status: true } });
      if (!org) throw new NotFoundError("Organization", request.organizationId);
      previous = org.status;
      if (org.status !== "OFFBOARDING") {
        await transitionOrganization(actor, request.organizationId, "offboard", `Deletion request ${requestId} approved by ${approvals} platform admins`, { requestId: options.requestId });
      }
    }
    const deleteAfter = request.kind === "DELETE" ? new Date(now.getTime() + request.retentionDays * DAY_MS) : null;
    await tx.platformDataRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", approvedAt: now, deleteAfter, previousOrgStatus: previous, exportStatus: "PACKAGING", updatedAt: now },
    });
    await recordPlatformAudit(tx, { actorIdentityId: actor.identityId, actorLabel: actor.email, action: "data_request.approved", targetType: "DataRequest", targetId: requestId, organizationId: request.organizationId, organizationSlug: request.organizationSlug, reason: comment, metadata: { kind: request.kind, approvals, ...(deleteAfter ? { deleteAfter: deleteAfter.toISOString() } : {}) }, requestId: options.requestId ?? null });
    return { status: "APPROVED" as const, startExport: true, organizationId: request.organizationId };
  });

  if (outcome.startExport) {
    await enqueueExportJob(outcome.organizationId!, requestId);
  }
  return getDataRequest(requestId);
}

async function enqueueExportJob(organizationId: string, requestId: string) {
  await enqueueJobFor({ organizationId, type: ORG_EXPORT_JOB, payload: { requestId } });
}

/** Queues packaging again after a failure. */
export async function retryExport(actor: Actor, requestId: string, options: { requestId?: string | null } = {}) {
  const row = await adminDb.platformDataRequest.findUnique({ where: { id: requestId } });
  if (!row) throw new NotFoundError("Data request", requestId);
  if (row.status !== "APPROVED" || (row.exportStatus !== "FAILED" && row.exportStatus !== "EXPIRED")) {
    throw new ValidationError("Only an approved request whose export failed or expired can be packaged again.", [{ path: "status", message: "Nothing to retry.", code: "NOTHING_TO_RETRY" }]);
  }
  await adminDb.platformDataRequest.update({ where: { id: requestId }, data: { exportStatus: "PACKAGING", exportError: null, exportPurgedAt: null } });
  await recordPlatformAudit(adminDb, { actorIdentityId: actor.identityId, actorLabel: actor.email, action: "data_request.export_retried", targetType: "DataRequest", targetId: requestId, organizationId: row.organizationId, organizationSlug: row.organizationSlug, requestId: options.requestId ?? null });
  await enqueueExportJob(row.organizationId, requestId);
  return getDataRequest(requestId);
}

/** Closes a request that was not carried out. A DELETE that had started offboarding puts the organisation back as it was. */
export async function cancelDataRequest(actor: Actor, requestId: string, rawReason: string | undefined, options: { requestId?: string | null; now?: Date } = {}) {
  const reason = cleanReason(rawReason);
  const now = options.now ?? new Date();
  // Under the request's row lock, so a deletion that is starting and a cancellation cannot both win.
  const row = await adminDb.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM platform_data_requests WHERE id = ${requestId} FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundError("Data request", requestId);
    const current = await tx.platformDataRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (current.status !== "SUBMITTED" && current.status !== "APPROVED") {
      throw new ValidationError(`This request is already ${current.status.toLowerCase()}.`, [{ path: "status", message: "Already closed.", code: "NOT_OPEN" }]);
    }
    if (current.deletionStartedAt) {
      throw new ValidationError("The deletion has already started and can no longer be cancelled.", [{ path: "status", message: "Deletion in progress.", code: "DELETION_STARTED" }]);
    }
    await tx.platformDataRequest.update({ where: { id: requestId }, data: { status: "CANCELLED", closedAt: now, closedReason: reason, updatedAt: now } });
    await recordPlatformAudit(tx, { actorIdentityId: actor.identityId, actorLabel: actor.email, action: "data_request.cancelled", targetType: "DataRequest", targetId: requestId, organizationId: current.organizationId, organizationSlug: current.organizationSlug, reason, metadata: { kind: current.kind }, requestId: options.requestId ?? null });
    return current;
  });
  if (row.kind === "DELETE" && row.status === "APPROVED") {
    const org = await adminDb.organization.findUnique({ where: { id: row.organizationId }, select: { status: true } });
    if (org?.status === "OFFBOARDING") {
      await transitionOrganization(actor, row.organizationId, "reactivate", `Deletion request ${requestId} cancelled: ${reason}`, { requestId: options.requestId });
      if (row.previousOrgStatus === "SUSPENDED") {
        await transitionOrganization(actor, row.organizationId, "suspend", `Back to suspended after deletion request ${requestId} was cancelled`, { requestId: options.requestId });
      }
    }
  }
  return getDataRequest(requestId);
}

// ---------------------------------------------------------------------------
// Export packaging (the job)
// ---------------------------------------------------------------------------

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function organisationTables(): Promise<string[]> {
  const rows = await adminDb.$queryRaw<{ table_name: string }[]>`
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' AND c.table_name NOT LIKE '\\_prisma%'
    ORDER BY c.table_name`;
  return rows.map((r) => r.table_name).filter((t) => /^[a-z_0-9]+$/.test(t));
}

function redact(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !EXPORT_REDACTED_COLUMN.test(key)));
}

/** Every organisation-owned row, as JSON, except sign-in material and secrets. Management receives it all, payments included. */
export async function buildOrganisationExport(organizationId: string, now = new Date()) {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const counts: Record<string, number> = {};
  let bytes = 0;
  // Allow-list: a table is exported only when it is named in EXPORTED_TABLES (a test keeps both lists complete).
  for (const table of (await organisationTables()).filter((t) => EXPORTED_TABLES.includes(t))) {
    const extra = EXPORT_TABLE_FILTERS[table] ? ` AND ${EXPORT_TABLE_FILTERS[table]}` : "";
    const rows = await adminDb.$queryRawUnsafe<{ row: Record<string, unknown> }[]>(`SELECT row_to_json(t) AS row FROM "${table}" t WHERE t.organization_id = $1${extra}`, organizationId);
    if (rows.length === 0) continue;
    tables[table] = rows.map((r) => redact(r.row));
    counts[table] = rows.length;
    bytes += JSON.stringify(tables[table]).length;
    if (bytes > MAX_EXPORT_BYTES) throw new Error("The organisation's data is larger than one export file allows; split it with engineering.");
  }
  const members = await adminDb.membership.findMany({ where: { organizationId }, include: { user: { select: { name: true, email: true } }, role: { select: { key: true } } } });
  tables.members = members.map((m) => ({ membershipId: m.id, name: m.user.name, email: m.user.email, role: m.role.key, status: m.status }));
  counts.members = members.length;
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const manifest = {
    format: "figbloom-organisation-export/1",
    generatedAt: now.toISOString(),
    organization: { id: org.id, slug: org.slug, name: org.name, timezone: org.timezone, defaultCurrency: org.defaultCurrency, createdAt: org.createdAt.toISOString() },
    tableCounts: counts,
    note: "Rows are exported as stored. Sign-in material, tokens and secrets are left out, and uploaded file contents are not included (their records are).",
  };
  return { manifest, tables, counts };
}

/** The `platform.org_export` job: packages the export once (safe to repeat) and records where it is. */
export async function runOrganisationExportJob(organizationId: string, requestId: string, now = new Date()): Promise<{ requestId: string; tables: number; sizeBytes: number } | { skipped: string }> {
  const request = await adminDb.platformDataRequest.findFirst({ where: { id: requestId, organizationId } });
  if (!request) return { skipped: "no such request for this organisation" };
  if (request.status !== "APPROVED") return { skipped: `request is ${request.status}` };
  if (request.exportStatus === "READY") return { skipped: "already packaged" };
  try {
    const built = await buildOrganisationExport(organizationId, now);
    const body = gzipSync(Buffer.from(JSON.stringify({ manifest: built.manifest, tables: built.tables })));
    const key = buildStorageKey(organizationId, "orgexport", randomUUID());
    await getStorageDriver().putObject(key, body, { contentType: "application/gzip" });
    const checksum = createHash("sha256").update(body).digest("hex");
    const readyAt = new Date();
    await adminDb.platformDataRequest.update({
      where: { id: requestId },
      data: {
        exportStatus: "READY",
        exportStorageKey: key,
        exportFileName: `${request.organizationSlug}-export-${readyAt.toISOString().slice(0, 10)}.json.gz`,
        exportSizeBytes: body.length,
        exportChecksumSha256: checksum,
        exportTableCounts: built.counts,
        exportReadyAt: readyAt,
        exportExpiresAt: new Date(readyAt.getTime() + EXPORT_LINK_DAYS * DAY_MS),
        exportError: null,
        updatedAt: readyAt,
      },
    });
    await recordPlatformAudit(adminDb, { actorIdentityId: null, actorLabel: "system", action: "data_request.export_packaged", targetType: "DataRequest", targetId: requestId, organizationId, organizationSlug: request.organizationSlug, metadata: { tables: Object.keys(built.counts).length, sizeBytes: body.length } });
    return { requestId, tables: Object.keys(built.counts).length, sizeBytes: body.length };
  } catch (err) {
    await adminDb.platformDataRequest.update({ where: { id: requestId }, data: { exportStatus: "FAILED", exportError: (err instanceof Error ? err.message : "Export failed").slice(0, 300), updatedAt: new Date() } });
    await recordPlatformAudit(adminDb, { actorIdentityId: null, actorLabel: "system", action: "data_request.export_failed", targetType: "DataRequest", targetId: requestId, organizationId, organizationSlug: request.organizationSlug });
    throw err;
  }
}

/** Removes exports whose download window has ended (daily, from the maintenance cron). */
export async function purgeExpiredExports(now = new Date()): Promise<{ purged: number }> {
  const due = await adminDb.platformDataRequest.findMany({ where: { exportStatus: "READY", exportExpiresAt: { lte: now }, exportStorageKey: { not: null } } });
  for (const row of due) {
    await getStorageDriver().deleteObject(row.exportStorageKey!);
    await adminDb.platformDataRequest.update({ where: { id: row.id }, data: { exportStatus: "EXPIRED", exportPurgedAt: now, exportStorageKey: null, updatedAt: now } });
    await recordPlatformAudit(adminDb, { actorIdentityId: null, actorLabel: "system", action: "data_request.export_purged", targetType: "DataRequest", targetId: row.id, organizationId: row.organizationId, organizationSlug: row.organizationSlug });
  }
  return { purged: due.length };
}

// ---------------------------------------------------------------------------
// Irreversible deletion and the certificate
// ---------------------------------------------------------------------------

export interface DeletionGateResult {
  ok: boolean;
  /** Everything that still stands in the way, in plain words. Empty when `ok`. */
  blockers: string[];
}

/** Every condition for deleting, re-read from the database. Used by the deletion itself and shown in the console before the admin types the slug. */
export async function checkDeletionGate(requestId: string, now = new Date(), db: Pick<Prisma.TransactionClient, "platformDataRequest" | "organization"> = adminDb): Promise<DeletionGateResult & { request: PlatformDataRequest | null }> {
  const request = await db.platformDataRequest.findUnique({ where: { id: requestId }, include: { approvals: true } });
  if (!request) return { ok: false, blockers: ["There is no such request."], request: null };
  const blockers: string[] = [];
  if (request.kind !== "DELETE") blockers.push("Only a deletion request can delete an organisation.");
  if (request.status !== "APPROVED") blockers.push(`The request is ${request.status.toLowerCase()}, not approved.`);
  const approverRows = request.approvals.filter((a) => a.decision === "APPROVE");
  const identities = await getPlatformDb().platformIdentity.findMany({ where: { id: { in: approverRows.map((a) => a.approverIdentityId) } }, select: { id: true, status: true, credentialsResetAt: true } });
  const resetById = new Map(identities.map((i) => [i.id, i.credentialsResetAt]));
  // An approval stands only while its approver is still an active platform admin: suspending or removing an admin is what the team does
  // when an account may be compromised, and that account's earlier "yes" must not stay in force (G2.02, F-01).
  const activeIds = new Set(identities.filter((i) => i.status === "ACTIVE").map((i) => i.id));
  const approvers = new Set(approverRows.map((a) => a.approverIdentityId).filter((id) => activeIds.has(id)));
  if (approvers.size < APPROVALS_REQUIRED.DELETE) blockers.push(`Two different approvers are needed; there ${approvers.size === 1 ? "is" : "are"} ${approvers.size}.`);
  if (approverRows.some((a) => !activeIds.has(a.approverIdentityId))) {
    blockers.push("An approver is no longer an active platform admin (suspended or removed), so that approval no longer counts.");
  }
  if (approverRows.some((a) => isFreshlyReset(resetById.get(a.approverIdentityId), a.decidedAt))) {
    blockers.push("An approver's password or two-step sign-in was reset within 24 hours of approving. Approve again once 24 hours have passed.");
  }
  if (!request.deleteAfter) blockers.push("No waiting period has been set.");
  else if (request.deleteAfter.getTime() > now.getTime()) blockers.push(`The waiting period runs until ${request.deleteAfter.toISOString().slice(0, 10)}.`);
  if (!request.exportReadyAt) blockers.push("The organisation's export has not been packaged yet.");
  const org = await db.organization.findUnique({ where: { id: request.organizationId }, select: { status: true } });
  if (!org) blockers.push("The organisation no longer exists.");
  else if (org.status !== "OFFBOARDING") blockers.push(`The organisation is ${org.status.toLowerCase()}, not offboarding.`);
  return { ok: blockers.length === 0, blockers, request };
}

async function countOrganisationRows(organizationId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of await organisationTables()) {
    const rows = await adminDb.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${table}" WHERE organization_id = $1`, organizationId);
    const n = Number(rows[0]?.n ?? 0);
    if (n > 0) counts[table] = n;
  }
  return counts;
}

/**
 * The irreversible step. Refuses unless {@link checkDeletionGate} passes and the caller types the organisation's slug.
 * Stored files go first (an object store cannot roll back), then one transaction removes the organisation's rows, keeps a tombstone,
 * and writes the certificate, the request's completion, the lifecycle event and the audit entry together.
 */
export async function executeDeletion(actor: Actor, requestId: string, input: { confirmSlug: string }, options: { now?: Date; requestId?: string | null } = {}) {
  const now = options.now ?? new Date();
  const gate = await checkDeletionGate(requestId, now);
  if (!gate.ok || !gate.request) {
    throw new ValidationError(gate.blockers[0] ?? "Deletion is not allowed.", gate.blockers.map((message) => ({ path: "request", message, code: "DELETION_BLOCKED" })));
  }
  const request = gate.request;
  if (input.confirmSlug?.trim().toLowerCase() !== request.organizationSlug) {
    throw new ValidationError("Type the organisation's slug exactly to confirm.", [{ path: "confirmSlug", message: "Does not match the organisation's slug.", code: "CONFIRMATION_MISMATCH" }]);
  }
  const organizationId = request.organizationId;

  // Step 1, one short transaction: lock the request and the organisation, re-check everything under the lock, and record that the
  // deletion has started. From here a cancellation is refused. Running this again after a crash passes the same checks (resumable).
  await adminDb.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM platform_data_requests WHERE id = ${requestId} FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundError("Data request", requestId);
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
    const again = await checkDeletionGate(requestId, now, tx);
    if (!again.ok) {
      throw new ValidationError(again.blockers[0] ?? "Deletion is not allowed.", again.blockers.map((message) => ({ path: "request", message, code: "DELETION_BLOCKED" })));
    }
    if (!request.deletionStartedAt) {
      await tx.platformDataRequest.update({ where: { id: requestId }, data: { deletionStartedAt: now, updatedAt: now } });
      await recordPlatformAudit(tx, { actorIdentityId: actor.identityId, actorLabel: actor.email, action: "data_request.deletion_started", targetType: "DataRequest", targetId: requestId, organizationId, organizationSlug: request.organizationSlug, requestId: options.requestId ?? null });
    }
  });

  const approvals = await adminDb.platformDataRequestApproval.findMany({ where: { requestId, decision: "APPROVE" }, orderBy: { decidedAt: "asc" } });
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: organizationId } });

  const tableCounts = await countOrganisationRows(organizationId);
  const memberUserIds = (await adminDb.membership.findMany({ where: { organizationId }, select: { userId: true } })).map((m) => m.userId);

  // Every member's chat footprint goes first, through the chat erasure (B6.27): messages deleted, chat files removed, mentions blanked.
  // (The rows would go with the organisation anyway; this also removes the stored files and keeps one rule for what erasing a person means.)
  const chatErasure = { messagesDeleted: 0, filesDeleted: 0 };
  for (const m of await adminDb.membership.findMany({ where: { organizationId }, select: { id: true } })) {
    const erased = await eraseMemberChat({ organizationId, membershipId: m.id, policy: "DELETE", requestId: options.requestId ?? undefined, now });
    chatErasure.messagesDeleted += erased.messagesDeleted;
    chatErasure.filesDeleted += erased.filesDeleted;
  }

  // Stored bytes next: nothing can bring them back. Only after step 1 committed; deleting an object twice is harmless, so a
  // crash here is resumed by calling the deletion again.
  const files = await adminDb.file.findMany({ where: { organizationId }, select: { storageKey: true } });
  const driver = getStorageDriver();
  let filesRemoved = 0;
  for (const f of files) {
    await driver.deleteObject(f.storageKey);
    filesRemoved += 1;
  }

  const certificate = await adminDb.$transaction(async (tx) => {
    // Step 2: still the same request, still started, not cancelled meanwhile.
    await tx.$queryRaw`SELECT id FROM platform_data_requests WHERE id = ${requestId} FOR UPDATE`;
    const still = await tx.platformDataRequest.findUniqueOrThrow({ where: { id: requestId }, select: { status: true, deletionStartedAt: true } });
    if (still.status !== "APPROVED" || !still.deletionStartedAt) {
      throw new ValidationError("The request is no longer approved for deletion.", [{ path: "request", message: "Request changed.", code: "DELETION_BLOCKED" }]);
    }
    await tx.$executeRaw`DELETE FROM organizations WHERE id = ${organizationId}`;
    // The tombstone keeps the id and slug (a slug is never reused and the platform's records still point at the id); the name goes.
    await tx.$executeRaw`
      INSERT INTO organizations (id, name, slug, status, created_at, updated_at)
      VALUES (${organizationId}, 'Offboarded organisation', ${org.slug}, 'OFFBOARDED'::"OrganizationStatus", ${org.createdAt}, now())`;
    // Accounts that only ever belonged to this organisation go too; anyone who also belongs elsewhere stays.
    const removedUsers = await tx.$executeRaw`
      DELETE FROM users u WHERE u.id = ANY(${memberUserIds}::text[]) AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id)`;

    const content = {
      certificateOf: "Irreversible deletion of an organisation's data",
      organization: { id: organizationId, slug: org.slug, name: org.name, createdAt: org.createdAt.toISOString() },
      request: {
        id: requestId,
        submittedAt: request.submittedAt.toISOString(),
        requestedBy: request.requestedByLabel,
        approvedAt: request.approvedAt?.toISOString() ?? null,
        approvals: approvals.map((a) => ({ approver: a.approverLabel, decidedAt: a.decidedAt.toISOString() })),
        waitingPeriodDays: request.retentionDays,
        deleteAfter: request.deleteAfter?.toISOString() ?? null,
      },
      export: { checksumSha256: request.exportChecksumSha256, sizeBytes: request.exportSizeBytes, readyAt: request.exportReadyAt?.toISOString() ?? null },
      executed: { at: now.toISOString(), by: actor.email },
      deleted: { tableRowCounts: tableCounts, storedFiles: filesRemoved, userAccounts: removedUsers, chatMessagesErased: chatErasure.messagesDeleted, chatFilesErased: chatErasure.filesDeleted },
      retained: "The organisation's id and slug (so the slug is never reused), this certificate, and the platform audit log.",
    };
    const contentSha256 = createHash("sha256").update(canonicalJson(content)).digest("hex");
    const saved = await tx.platformDeletionCertificate.create({
      data: { requestId, organizationId, organizationSlug: org.slug, organizationName: org.name, issuedAt: now, issuedByIdentityId: actor.identityId, content, contentSha256 },
    });
    await tx.platformDataRequest.update({ where: { id: requestId }, data: { status: "COMPLETED", closedAt: now, closedReason: "Deleted", updatedAt: now } });
    await tx.organizationLifecycleEvent.create({
      data: { organizationId, fromStatus: "OFFBOARDING", toStatus: "OFFBOARDED", action: "delete", reason: `Deletion request ${requestId} executed`, actorIdentityId: actor.identityId },
    });
    await recordPlatformAudit(tx, {
      actorIdentityId: actor.identityId,
      actorLabel: actor.email,
      action: "organization.deleted",
      targetType: "Organization",
      targetId: organizationId,
      organizationId,
      organizationSlug: org.slug,
      reason: `Deletion request ${requestId}`,
      metadata: { certificateId: saved.id, contentSha256, tables: Object.keys(tableCounts).length, files: filesRemoved },
      requestId: options.requestId ?? null,
    });
    return saved;
  }, { timeout: 120_000, maxWait: 30_000 });

  return {
    request: await getDataRequest(requestId),
    certificate: { id: certificate.id, issuedAt: certificate.issuedAt.toISOString(), contentSha256: certificate.contentSha256, content: certificate.content },
  };
}

/** The stored certificate, and a check that its content still matches its hash. */
export async function getDeletionCertificate(requestId: string) {
  const row = await getPlatformDb().platformDeletionCertificate.findUnique({ where: { requestId } });
  if (!row) throw new NotFoundError("Deletion certificate", requestId);
  const intact = createHash("sha256").update(canonicalJson(row.content)).digest("hex") === row.contentSha256;
  return { id: row.id, requestId: row.requestId, organizationId: row.organizationId, organizationSlug: row.organizationSlug, issuedAt: row.issuedAt.toISOString(), contentSha256: row.contentSha256, intact, content: row.content };
}
