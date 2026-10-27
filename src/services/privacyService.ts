import { stringifyCsv as stringify } from "../lib/csv";
import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError, type ValidationIssue } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { parseDateOnly } from "../lib/inputParsing";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import { recordAuditEvent } from "../repositories/auditEvents";
import { getStorageDriver } from "../storage";
import { updateContact } from "./contactService";
import { countForExport, EXPORT_FILTER_KEYS, type DataEntity } from "./dataRunService";
import { eraseContactData } from "./erasureService";
import { issueDownloadLinkAuthorised, storeGeneratedFile } from "./fileService";
import {
  DEFAULT_EXPORT_RIGHTS,
  EXPIRY_RANGE,
  LEGAL_HOLD_KEY,
  ORG_REQUESTS_KEY,
  RETENTION_KEY,
  RETENTION_TYPES,
  THRESHOLD_RANGE,
  EXPORT_RIGHTS_KEY,
  loadExportRights,
  loadLegalHold,
  loadRetention,
  writeSetting,
} from "./privacySettings";

/**
 * Data and privacy (FIG-1062, B4.05, screens S9 and OS6): control and evidence for data protection (Kenya DPA).
 *
 *   export rights        who may export in bulk, the row count above which an export needs approval, and the approval itself
 *   retention            how long each kind of data is kept, a documented default for each, a daily purge that respects a legal hold
 *   data-subject requests access, rectification and erasure, each with a status, a due date, evidence notes and an audit trail
 *   organisation requests exporting or deleting the whole organisation, handed to the platform queue (B6.09)
 *
 * Management only (`security.manage`). Every change and every request step is audited; the audit rows hold ids and counts, never a
 * person's details. Deleting one person needs two different Management members to confirm, until the approvals engine (B6.13) arrives.
 */

const PERMISSION = "security.manage";
const DAY_MS = 86_400_000;
export const DEFAULT_DUE_DAYS = 30;

// ---------------------------------------------------------------------------
// Overview and settings
// ---------------------------------------------------------------------------

export async function getPrivacyOverview(ctx: AuthContext, now = new Date()) {
  requirePermission(ctx, PERMISSION);
  const org = ctx.organizationId;
  const [exportRights, retention, legalHold, open, overdue, pendingApprovals, orgRequests] = await Promise.all([
    loadExportRights(org),
    loadRetention(org),
    loadLegalHold(org),
    adminDb.dataSubjectRequest.count({ where: { organizationId: org, status: { in: ["OPEN", "IN_PROGRESS", "AWAITING_SECOND_CONFIRMATION"] } } }),
    adminDb.dataSubjectRequest.count({ where: { organizationId: org, status: { in: ["OPEN", "IN_PROGRESS", "AWAITING_SECOND_CONFIRMATION"] }, dueOn: { lt: startOfDay(now) } } }),
    adminDb.exportApproval.count({ where: { organizationId: org, status: "PENDING" } }),
    loadOrganisationRequests(org),
  ]);
  return {
    exportRights: { ...exportRights, defaults: DEFAULT_EXPORT_RIGHTS, thresholdRange: THRESHOLD_RANGE, expiryRange: EXPIRY_RANGE },
    retention: RETENTION_TYPES.map((t) => ({ key: t.key, label: t.label, description: t.description, unit: t.unit, value: retention[t.key] ?? null, default: t.default, min: t.min, max: t.max, isDefault: retention[t.key] === t.default })),
    legalHold,
    requests: { open, overdue, dueDays: DEFAULT_DUE_DAYS },
    pendingExportApprovals: pendingApprovals,
    organisationRequests: orgRequests,
  };
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function updateExportRights(ctx: AuthContext, patch: { allowedRoleKeys?: string[]; approvalThreshold?: number; approvalExpiryHours?: number }) {
  requirePermission(ctx, PERMISSION);
  const issues: ValidationIssue[] = [];
  const before = await loadExportRights(ctx.organizationId);
  const next = { ...before };
  if (patch.allowedRoleKeys !== undefined) {
    const roles = await adminDb.role.findMany({ select: { key: true } });
    const known = new Set(roles.map((r) => r.key));
    const bad = patch.allowedRoleKeys.filter((r) => !known.has(r));
    if (bad.length > 0) issues.push({ path: "allowedRoleKeys", message: `Unknown roles: ${bad.join(", ")}.` });
    next.allowedRoleKeys = [...new Set(["MANAGEMENT", ...patch.allowedRoleKeys])];
  }
  if (patch.approvalThreshold !== undefined) {
    if (!Number.isInteger(patch.approvalThreshold) || patch.approvalThreshold < THRESHOLD_RANGE.min || patch.approvalThreshold > THRESHOLD_RANGE.max) {
      issues.push({ path: "approvalThreshold", message: `A whole number of rows from ${THRESHOLD_RANGE.min} to ${THRESHOLD_RANGE.max}.` });
    } else next.approvalThreshold = patch.approvalThreshold;
  }
  if (patch.approvalExpiryHours !== undefined) {
    if (!Number.isInteger(patch.approvalExpiryHours) || patch.approvalExpiryHours < EXPIRY_RANGE.min || patch.approvalExpiryHours > EXPIRY_RANGE.max) {
      issues.push({ path: "approvalExpiryHours", message: `A whole number of hours from ${EXPIRY_RANGE.min} to ${EXPIRY_RANGE.max}.` });
    } else next.approvalExpiryHours = patch.approvalExpiryHours;
  }
  if (issues.length > 0) throw new ValidationError("These export rights are not valid.", issues);
  await writeSetting(ctx.organizationId, EXPORT_RIGHTS_KEY, next as unknown as Prisma.InputJsonValue);
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "privacy.export_rights_updated", entityType: "Organization", entityId: ctx.organizationId, previousValue: before as unknown as Prisma.InputJsonValue, newValue: next as unknown as Prisma.InputJsonValue });
  return next;
}

/** `null` keeps the data until someone decides otherwise; `"DEFAULT"` goes back to the documented default. */
export async function updateRetention(ctx: AuthContext, patch: Record<string, number | null | "DEFAULT">) {
  requirePermission(ctx, PERMISSION);
  const issues: ValidationIssue[] = [];
  const before = await loadRetention(ctx.organizationId);
  const next = { ...before };
  for (const [key, value] of Object.entries(patch)) {
    const def = RETENTION_TYPES.find((t) => t.key === key);
    if (!def) {
      issues.push({ path: key, message: `"${key}" is not a kind of data with a retention period.` });
      continue;
    }
    if (value === "DEFAULT") next[key] = def.default;
    else if (value === null) {
      // Keeping security and operational logs forever is a choice that the screen should make visible, but it is allowed; the types
      // that have a documented default may be switched to "keep" only where the data is not personal history.
      next[key] = null;
    } else if (!Number.isInteger(value) || value < def.min || value > def.max) {
      issues.push({ path: key, message: `${def.label}: a whole number of ${def.unit} from ${def.min} to ${def.max}.` });
    } else next[key] = value;
  }
  if (issues.length > 0) throw new ValidationError("These retention periods are not valid.", issues);
  await writeSetting(ctx.organizationId, RETENTION_KEY, next as Prisma.InputJsonValue);
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "privacy.retention_updated", entityType: "Organization", entityId: ctx.organizationId, previousValue: before as Prisma.InputJsonValue, newValue: next as Prisma.InputJsonValue });
  return next;
}

export async function setLegalHold(ctx: AuthContext, input: { active: boolean; reason?: string }) {
  requirePermission(ctx, PERMISSION);
  const before = await loadLegalHold(ctx.organizationId);
  if (input.active) {
    const reason = input.reason?.trim();
    if (!reason || reason.length > 500) throw new ValidationError("Say why the legal hold is needed (up to 500 characters).", [{ path: "reason", message: "A reason is required." }]);
    const hold = { active: true, reason, since: new Date().toISOString(), byMembershipId: ctx.membershipId };
    await writeSetting(ctx.organizationId, LEGAL_HOLD_KEY, hold);
    await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "privacy.legal_hold_placed", entityType: "Organization", entityId: ctx.organizationId, metadata: { reason } });
    return hold;
  }
  if (!before.active) return before;
  const released = { active: false, reason: null, since: null, byMembershipId: null };
  await writeSetting(ctx.organizationId, LEGAL_HOLD_KEY, released);
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "privacy.legal_hold_released", entityType: "Organization", entityId: ctx.organizationId, metadata: { wasSince: before.since } });
  return { ...released, active: false as const };
}

// ---------------------------------------------------------------------------
// Export approvals
// ---------------------------------------------------------------------------

const EXPORT_ENTITIES: DataEntity[] = ["LEAD", "CONTACT", "COMPANY", "DEAL"];
const EXPORT_PERMISSION: Record<DataEntity, string> = { LEAD: "leads.export", CONTACT: "contacts.export", COMPANY: "companies.export", DEAL: "deals.export" };

function presentApproval(a: { id: string; entity: string; filters: unknown; rowCount: number; reason: string | null; status: string; requestedByMembershipId: string; decidedByMembershipId: string | null; decidedAt: Date | null; decisionNote: string | null; expiresAt: Date | null; usedAt: Date | null; createdAt: Date }, now: Date) {
  const expired = a.status === "APPROVED" && a.expiresAt !== null && a.expiresAt <= now;
  return { id: a.id, entity: a.entity, filters: a.filters, rowCount: a.rowCount, reason: a.reason, status: expired ? "EXPIRED" : a.status, requestedByMembershipId: a.requestedByMembershipId, decidedByMembershipId: a.decidedByMembershipId, decidedAt: a.decidedAt, decisionNote: a.decisionNote, expiresAt: a.expiresAt, usedAt: a.usedAt, createdAt: a.createdAt };
}

/** Ask for permission to run one bulk export above the threshold. The person needs the export permission for that kind of record. */
export async function requestExportApproval(ctx: AuthContext, input: { entity: string; filters?: Record<string, unknown>; reason?: string }, now = new Date()) {
  const entity = input.entity as DataEntity;
  if (!EXPORT_ENTITIES.includes(entity)) throw new ValidationError("Choose what you want to export.", [{ path: "entity", message: "LEAD, CONTACT, COMPANY or DEAL." }]);
  requirePermission(ctx, EXPORT_PERMISSION[entity]);
  const filters = input.filters ?? {};
  const unknown = Object.keys(filters).filter((k) => !(EXPORT_FILTER_KEYS as readonly string[]).includes(k));
  if (unknown.length > 0) throw new ValidationError("Some export filters are not recognised.", unknown.map((k) => ({ path: `filters.${k}`, message: "Unknown filter." })));
  const reason = input.reason?.trim() || null;
  if (reason && reason.length > 500) throw new ValidationError("Keep the reason under 500 characters.", [{ path: "reason", message: "Too long." }]);

  const [rights, rowCount] = await Promise.all([loadExportRights(ctx.organizationId), countForExport(ctx, entity, filters)]);
  if (rowCount <= rights.approvalThreshold) {
    throw new ValidationError(`That export has ${rowCount} rows, at or under the ${rights.approvalThreshold} that need approval. Run it directly.`, [{ path: "entity", message: "No approval needed.", code: "APPROVAL_NOT_NEEDED" }]);
  }
  const approval = await adminDb.exportApproval.create({ data: { organizationId: ctx.organizationId, entity, filters: filters as Prisma.InputJsonValue, rowCount, reason, requestedByMembershipId: ctx.membershipId } });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "export_approval.requested", entityType: "ExportApproval", entityId: approval.id, metadata: { entity, rowCount } });
  return presentApproval(approval, now);
}

/** Management sees every request; anyone else sees their own. */
export async function listExportApprovals(ctx: AuthContext, query: { status?: string; paging?: PageRequest } = {}, now = new Date()) {
  const all = hasPermission(ctx, PERMISSION);
  const paging = resolvePaging(query.paging);
  const where = { organizationId: ctx.organizationId, ...(all ? {} : { requestedByMembershipId: ctx.membershipId }), ...(query.status && query.status !== "EXPIRED" ? { status: query.status } : {}) };
  const [rows, total] = await Promise.all([
    adminDb.exportApproval.findMany({ where, orderBy: { createdAt: "desc" }, skip: paging.skip, take: paging.take }),
    adminDb.exportApproval.count({ where }),
  ]);
  return buildPage(rows.map((r) => presentApproval(r, now)), total, paging);
}

export async function decideExportApproval(ctx: AuthContext, id: string, input: { approve: boolean; note?: string }, now = new Date()) {
  requirePermission(ctx, PERMISSION);
  const approval = await adminDb.exportApproval.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!approval) throw new NotFoundError("ExportApproval", id);
  if (approval.status !== "PENDING") throw new ValidationError(`This request was already ${approval.status.toLowerCase()}.`, [{ path: "status", message: "Already decided.", code: "ALREADY_DECIDED" }]);
  if (approval.requestedByMembershipId === ctx.membershipId) {
    throw new ValidationError("Someone else has to decide your own request.", [{ path: "id", message: "A different Management member must decide.", code: "SELF_APPROVAL" }]);
  }
  const rights = await loadExportRights(ctx.organizationId);
  const updated = await adminDb.exportApproval.update({
    where: { id },
    data: {
      status: input.approve ? "APPROVED" : "REJECTED",
      decidedByMembershipId: ctx.membershipId,
      decidedAt: now,
      decisionNote: input.note?.trim().slice(0, 500) || null,
      expiresAt: input.approve ? new Date(now.getTime() + rights.approvalExpiryHours * 3_600_000) : null,
    },
  });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: input.approve ? "export_approval.approved" : "export_approval.rejected", entityType: "ExportApproval", entityId: id, metadata: { entity: approval.entity, rowCount: approval.rowCount } });
  return presentApproval(updated, now);
}

// ---------------------------------------------------------------------------
// Data-subject requests
// ---------------------------------------------------------------------------

export const REQUEST_KINDS = ["ACCESS", "RECTIFICATION", "ERASURE"] as const;
const ACTIVE = ["OPEN", "IN_PROGRESS", "AWAITING_SECOND_CONFIRMATION"];

type RequestRow = NonNullable<Awaited<ReturnType<typeof adminDb.dataSubjectRequest.findFirst>>>;

function presentRequest(r: RequestRow, now = new Date()) {
  const active = ACTIVE.includes(r.status);
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    subject: { contactId: r.contactId, label: r.subjectLabel },
    dueOn: r.dueOn,
    overdue: active && r.dueOn < startOfDay(now),
    daysLeft: active ? Math.ceil((r.dueOn.getTime() - startOfDay(now).getTime()) / DAY_MS) : null,
    evidenceNotes: r.evidenceNotes,
    requestedByMembershipId: r.requestedByMembershipId,
    confirmations: { first: r.firstConfirmedByMembershipId ? { by: r.firstConfirmedByMembershipId, at: r.firstConfirmedAt } : null, second: r.secondConfirmedByMembershipId ? { by: r.secondConfirmedByMembershipId, at: r.secondConfirmedAt } : null },
    result: r.result,
    hasExport: r.exportFileId !== null,
    completedAt: r.completedAt,
    createdAt: r.createdAt,
  };
}

async function loadRequest(ctx: AuthContext, id: string): Promise<RequestRow> {
  requirePermission(ctx, PERMISSION);
  const row = await adminDb.dataSubjectRequest.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!row) throw new NotFoundError("DataSubjectRequest", id);
  return row;
}

function assertOpen(r: RequestRow) {
  if (!ACTIVE.includes(r.status)) throw new ValidationError(`This request is already ${r.status.toLowerCase()}.`, [{ path: "status", message: "It is closed.", code: "REQUEST_CLOSED" }]);
}

export async function createDataSubjectRequest(ctx: AuthContext, input: { kind: string; contactId: string; evidenceNotes?: string; dueOn?: string }, now = new Date()) {
  requirePermission(ctx, PERMISSION);
  if (!(REQUEST_KINDS as readonly string[]).includes(input.kind)) throw new ValidationError("Choose the kind of request.", [{ path: "kind", message: "ACCESS, RECTIFICATION or ERASURE." }]);
  const contact = await adminDb.contact.findFirst({ where: { id: input.contactId, organizationId: ctx.organizationId }, select: { id: true, firstName: true, lastName: true } });
  if (!contact) throw new NotFoundError("Contact", input.contactId);
  const dueOn = input.dueOn ? parseDateOnly(input.dueOn, "dueOn") : new Date(startOfDay(now).getTime() + DEFAULT_DUE_DAYS * DAY_MS);
  if (dueOn < startOfDay(now)) throw new ValidationError("The due date cannot be in the past.", [{ path: "dueOn", message: "Choose today or later." }]);
  const evidence = input.evidenceNotes?.trim() || null;
  if (evidence && evidence.length > 8000) throw new ValidationError("Keep the evidence notes under 8000 characters.", [{ path: "evidenceNotes", message: "Too long." }]);
  const row = await adminDb.dataSubjectRequest.create({
    data: {
      organizationId: ctx.organizationId,
      kind: input.kind,
      contactId: contact.id,
      subjectLabel: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
      dueOn,
      evidenceNotes: evidence ? stamped(evidence, ctx, now) : null,
      requestedByMembershipId: ctx.membershipId,
    },
  });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "data_subject_request.created", entityType: "DataSubjectRequest", entityId: row.id, metadata: { kind: input.kind, dueOn: dueOn.toISOString().slice(0, 10) } });
  return presentRequest(row, now);
}

function stamped(note: string, ctx: AuthContext, now: Date): string {
  return `[${now.toISOString().slice(0, 16).replace("T", " ")} by ${ctx.membershipId.slice(0, 8)}] ${note}`;
}

export async function listDataSubjectRequests(ctx: AuthContext, query: { status?: string; kind?: string; overdue?: boolean; paging?: PageRequest } = {}, now = new Date()) {
  requirePermission(ctx, PERMISSION);
  const paging = resolvePaging(query.paging);
  const where: Prisma.DataSubjectRequestWhereInput = {
    organizationId: ctx.organizationId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.overdue ? { status: { in: ACTIVE }, dueOn: { lt: startOfDay(now) } } : {}),
  };
  const [rows, total] = await Promise.all([
    adminDb.dataSubjectRequest.findMany({ where, orderBy: [{ dueOn: "asc" }, { createdAt: "desc" }], skip: paging.skip, take: paging.take }),
    adminDb.dataSubjectRequest.count({ where }),
  ]);
  return buildPage(rows.map((r) => presentRequest(r, now)), total, paging);
}

export async function getDataSubjectRequest(ctx: AuthContext, id: string, now = new Date()) {
  return presentRequest(await loadRequest(ctx, id), now);
}

export async function addEvidenceNote(ctx: AuthContext, id: string, note: string, now = new Date()) {
  const row = await loadRequest(ctx, id);
  const text = (note ?? "").trim();
  if (!text || text.length > 2000) throw new ValidationError("Write the note (up to 2000 characters).", [{ path: "note", message: "A note is required." }]);
  const next = [row.evidenceNotes, stamped(text, ctx, now)].filter(Boolean).join("\n");
  if (next.length > 8000) throw new ValidationError("The evidence notes are full.", [{ path: "note", message: "At most 8000 characters in total." }]);
  const updated = await adminDb.dataSubjectRequest.update({ where: { id }, data: { evidenceNotes: next, status: row.status === "OPEN" ? "IN_PROGRESS" : row.status } });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "data_subject_request.evidence_added", entityType: "DataSubjectRequest", entityId: id, metadata: { length: text.length } });
  return presentRequest(updated, now);
}

export async function rejectDataSubjectRequest(ctx: AuthContext, id: string, reason: string, now = new Date()) {
  const row = await loadRequest(ctx, id);
  assertOpen(row);
  const text = (reason ?? "").trim();
  if (!text) throw new ValidationError("Say why the request is rejected, for the record.", [{ path: "reason", message: "A reason is required." }]);
  const updated = await adminDb.dataSubjectRequest.update({ where: { id }, data: { status: "REJECTED", completedAt: now, evidenceNotes: [row.evidenceNotes, stamped(`Rejected: ${text}`, ctx, now)].filter(Boolean).join("\n") } });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "data_subject_request.rejected", entityType: "DataSubjectRequest", entityId: id, metadata: { kind: row.kind } });
  return presentRequest(updated, now);
}

function requireKind(row: RequestRow, kind: (typeof REQUEST_KINDS)[number]) {
  if (row.kind !== kind) throw new ValidationError(`This is a ${row.kind.toLowerCase()} request, not ${kind.toLowerCase()}.`, [{ path: "kind", message: "Wrong kind of request.", code: "WRONG_KIND" }]);
}

function requireContact(row: RequestRow): string {
  if (!row.contactId) throw new ValidationError("The person's record is gone, so there is nothing left to do for this request.", [{ path: "contactId", message: "No record.", code: "NO_RECORD" }]);
  return row.contactId;
}

/** Everything held about one person, as one CSV: record type, record id, field, value. Deal values follow the caller's permission. */
async function collectSubjectData(ctx: AuthContext, contactId: string) {
  const org = ctx.organizationId;
  const contact = await adminDb.contact.findFirstOrThrow({ where: { id: contactId, organizationId: org }, include: { company: { select: { name: true } }, tagLinks: { include: { tag: true } } } });
  const [leads, deals, activities, tasks, communications, attachments] = await Promise.all([
    adminDb.lead.findMany({ where: { organizationId: org, contactId }, include: { leadStatus: true, leadSource: true, serviceInterest: true } }),
    adminDb.deal.findMany({ where: { organizationId: org, primaryContactId: contactId }, include: { pipelineStage: true, company: { select: { name: true } } } }),
    adminDb.activity.findMany({ where: { organizationId: org, contactId } }),
    adminDb.task.findMany({ where: { organizationId: org, contactId } }),
    adminDb.communication.findMany({ where: { organizationId: org, contactId } }),
    adminDb.attachment.findMany({ where: { organizationId: org, OR: [{ contactId }, { task: { contactId } }], deletedAt: null }, include: { file: { select: { name: true, sizeBytes: true } } } }),
  ]);
  const rows: { record_type: string; record_id: string; field: string; value: string }[] = [];
  const add = (type: string, id: string, fields: Record<string, unknown>) => {
    for (const [field, value] of Object.entries(fields)) {
      if (value === null || value === undefined || value === "") continue;
      rows.push({ record_type: type, record_id: id, field, value: value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value) });
    }
  };
  add("contact", contact.id, { first_name: contact.firstName, last_name: contact.lastName, email: contact.email, phone: contact.phone, job_title: contact.jobTitle, department: contact.department, company: contact.company?.name, notes: contact.notes, custom_fields: Object.keys((contact.customFields as object) ?? {}).length ? contact.customFields : null, tags: contact.tagLinks.map((l) => l.tag.name).join("; "), created_at: contact.createdAt, last_contacted_at: contact.lastContactedAt });
  for (const l of leads) add("lead", l.id, { status: l.leadStatus.name, source: l.leadSource?.name, service_interest: l.serviceInterest?.name, temperature: l.temperature, notes: l.notes, created_at: l.createdAt });
  const showValue = hasPermission(ctx, "deals.view.value");
  for (const d of deals) add("deal", d.id, { company: d.company.name, stage: d.pipelineStage.name, outcome: d.outcome, value: showValue ? d.value?.toString() : undefined, expected_close_date: d.expectedCloseDate, notes: d.notes, created_at: d.createdAt });
  for (const a of activities) add("activity", a.id, { type: a.type, subject: a.subject, description: a.description, outcome: a.outcome, occurred_at: a.occurredAt });
  for (const t of tasks) add("task", t.id, { title: t.title, description: t.description, status: t.status, due_at: t.dueAt, created_at: t.createdAt });
  for (const c of communications) add("conversation", c.id, { channel: c.channel, direction: c.direction, subject: c.subject, summary: c.summary, occurred_at: c.occurredAt, counterparty_email: c.counterpartyEmail, counterparty_phone: c.counterpartyPhone });
  for (const a of attachments) add("attachment", a.id, { file_name: a.file.name, size_bytes: a.file.sizeBytes, title: a.title, added_at: a.createdAt });
  return { rows, counts: { leads: leads.length, deals: deals.length, activities: activities.length, tasks: tasks.length, conversations: communications.length, attachments: attachments.length } };
}

export async function fulfilAccessRequest(ctx: AuthContext, id: string, now = new Date()) {
  const row = await loadRequest(ctx, id);
  requireKind(row, "ACCESS");
  assertOpen(row);
  const contactId = requireContact(row);
  const { rows, counts } = await collectSubjectData(ctx, contactId);
  const file = await storeGeneratedFile({
    organizationId: ctx.organizationId,
    ownerMembershipId: ctx.membershipId,
    purpose: "EXPORT",
    name: `subject-access-${row.id.slice(0, 8)}.csv`,
    mimeType: "text/csv",
    data: Buffer.from(stringify(rows, { header: true, columns: ["record_type", "record_id", "field", "value"] })),
  });
  const updated = await adminDb.dataSubjectRequest.update({ where: { id }, data: { status: "COMPLETED", completedAt: now, exportFileId: file.id, result: counts as Prisma.InputJsonValue, firstConfirmedByMembershipId: ctx.membershipId, firstConfirmedAt: now } });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "data_subject_request.access_fulfilled", entityType: "DataSubjectRequest", entityId: id, metadata: { ...counts, rows: rows.length } });
  return { request: presentRequest(updated, now), download: await issueDownloadLinkAuthorised(file) };
}

/** A fresh download link for a completed access request. */
export async function getAccessDownload(ctx: AuthContext, id: string) {
  const row = await loadRequest(ctx, id);
  if (!row.exportFileId) throw new NotFoundError("File", `${id}/export`);
  const file = await adminDb.file.findFirst({ where: { id: row.exportFileId, organizationId: ctx.organizationId } });
  if (!file) throw new NotFoundError("File", row.exportFileId);
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "data_subject_request.access_downloaded", entityType: "DataSubjectRequest", entityId: id });
  return issueDownloadLinkAuthorised(file);
}

export async function fulfilRectificationRequest(
  ctx: AuthContext,
  id: string,
  corrections: { firstName?: string; lastName?: string | null; email?: string | null; phone?: string | null; jobTitle?: string | null; department?: string | null; notes?: string | null },
  now = new Date(),
) {
  const row = await loadRequest(ctx, id);
  requireKind(row, "RECTIFICATION");
  assertOpen(row);
  const contactId = requireContact(row);
  const fields = Object.keys(corrections).filter((k) => (corrections as Record<string, unknown>)[k] !== undefined);
  if (fields.length === 0) throw new ValidationError("Say what to correct.", [{ path: "corrections", message: "Nothing to change." }]);
  await updateContact(ctx, contactId, corrections as never);
  const contact = await adminDb.contact.findUniqueOrThrow({ where: { id: contactId } });
  const updated = await adminDb.dataSubjectRequest.update({ where: { id }, data: { status: "COMPLETED", completedAt: now, subjectLabel: [contact.firstName, contact.lastName].filter(Boolean).join(" "), result: { corrected: fields } as Prisma.InputJsonValue, firstConfirmedByMembershipId: ctx.membershipId, firstConfirmedAt: now } });
  // The field names, never the values: the contact's own audit history holds those.
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "data_subject_request.rectified", entityType: "DataSubjectRequest", entityId: id, metadata: { fields } });
  return presentRequest(updated, now);
}

/**
 * Erasure needs two different Management members to confirm, until the approvals engine (B6.13) takes over: the first confirmation
 * parks the request, the second runs the erasure. A legal hold stops it.
 */
export async function confirmErasure(ctx: AuthContext, id: string, now = new Date()) {
  const row = await loadRequest(ctx, id);
  requireKind(row, "ERASURE");
  assertOpen(row);
  const contactId = requireContact(row);
  const hold = await loadLegalHold(ctx.organizationId);
  if (hold.active) {
    throw new ValidationError("A legal hold is in place, so nothing can be erased until it is released.", [{ path: "legalHold", message: hold.reason ?? "Legal hold.", code: "LEGAL_HOLD" }]);
  }
  if (!row.firstConfirmedByMembershipId) {
    const updated = await adminDb.dataSubjectRequest.update({ where: { id }, data: { status: "AWAITING_SECOND_CONFIRMATION", firstConfirmedByMembershipId: ctx.membershipId, firstConfirmedAt: now } });
    await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "data_subject_request.erasure_confirmed_first", entityType: "DataSubjectRequest", entityId: id });
    return presentRequest(updated, now);
  }
  if (row.firstConfirmedByMembershipId === ctx.membershipId) {
    throw new ValidationError("A different Management member has to give the second confirmation.", [{ path: "id", message: "You already confirmed it.", code: "SAME_CONFIRMER" }]);
  }
  const claimed = await adminDb.dataSubjectRequest.updateMany({ where: { id, organizationId: ctx.organizationId, status: "AWAITING_SECOND_CONFIRMATION" }, data: { secondConfirmedByMembershipId: ctx.membershipId, secondConfirmedAt: now } });
  if (claimed.count !== 1) throw new ValidationError("This request was just handled by someone else.", [{ path: "id", message: "Already handled.", code: "REQUEST_CLOSED" }]);
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "data_subject_request.erasure_confirmed_second", entityType: "DataSubjectRequest", entityId: id });
  const result = await eraseContactData({ organizationId: ctx.organizationId, contactId, actorMembershipId: ctx.membershipId, requestId: id });
  // Closed rows carry no personal details: the working label goes with the person.
  const updated = await adminDb.dataSubjectRequest.update({ where: { id }, data: { status: "COMPLETED", completedAt: now, subjectLabel: "[erased]", contactId: null, result: result as unknown as Prisma.InputJsonValue } });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "data_subject_request.erasure_completed", entityType: "DataSubjectRequest", entityId: id, metadata: { contactsErased: result.contactsErased } });
  return presentRequest(updated, now);
}

// ---------------------------------------------------------------------------
// Organisation-level requests (handed to the platform queue, B6.09)
// ---------------------------------------------------------------------------

interface OrgRequest {
  id: string;
  kind: "EXPORT" | "DELETE";
  status: "SUBMITTED_TO_PLATFORM";
  note: string | null;
  requestedByMembershipId: string;
  submittedAt: string;
}

async function loadOrganisationRequests(organizationId: string): Promise<OrgRequest[]> {
  const row = await adminDb.organizationSetting.findUnique({ where: { organizationId_key: { organizationId, key: ORG_REQUESTS_KEY } } });
  return Array.isArray(row?.value) ? (row!.value as unknown as OrgRequest[]) : [];
}

/**
 * The organisation asking for all of its data, or to be deleted. The platform team carries these out with two-person approval
 * (B6.09); here the request is recorded, audited and listed so it is not lost, and nothing is exported or deleted by this call.
 */
export async function submitOrganisationDataRequest(ctx: AuthContext, input: { kind: string; note?: string }, now = new Date()) {
  requirePermission(ctx, PERMISSION);
  if (input.kind !== "EXPORT" && input.kind !== "DELETE") throw new ValidationError("Choose EXPORT or DELETE.", [{ path: "kind", message: "EXPORT or DELETE." }]);
  const existing = await loadOrganisationRequests(ctx.organizationId);
  if (existing.some((r) => r.kind === input.kind)) throw new ValidationError(`A request to ${input.kind === "EXPORT" ? "export" : "delete"} the organisation is already with the platform team.`, [{ path: "kind", message: "Already submitted.", code: "ALREADY_SUBMITTED" }]);
  const request: OrgRequest = { id: `${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`, kind: input.kind, status: "SUBMITTED_TO_PLATFORM", note: input.note?.trim().slice(0, 500) || null, requestedByMembershipId: ctx.membershipId, submittedAt: now.toISOString() };
  await writeSetting(ctx.organizationId, ORG_REQUESTS_KEY, [...existing, request] as unknown as Prisma.InputJsonValue);
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "organization.data_request_submitted", entityType: "Organization", entityId: ctx.organizationId, metadata: { kind: input.kind, requestId: request.id } });
  return request;
}

export async function listOrganisationDataRequests(ctx: AuthContext) {
  requirePermission(ctx, PERMISSION);
  return { items: await loadOrganisationRequests(ctx.organizationId) };
}

// ---------------------------------------------------------------------------
// Retention sweep (the daily job)
// ---------------------------------------------------------------------------

export interface RetentionSweepResult {
  skipped?: "LEGAL_HOLD";
  purged: Record<string, number>;
}

const monthsAgo = (now: Date, months: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);

/** Removes data older than the organisation's retention periods. Does nothing at all under a legal hold. Safe to repeat. */
export async function runRetentionSweep(organizationId: string, now = new Date()): Promise<RetentionSweepResult> {
  const hold = await loadLegalHold(organizationId);
  if (hold.active) return { skipped: "LEGAL_HOLD", purged: {} };
  const retention = await loadRetention(organizationId);
  const purged: Record<string, number> = {};
  const driver = getStorageDriver();

  if (retention.signInEvents) {
    purged.signInEvents = (await adminDb.signInEvent.deleteMany({ where: { organizationId, createdAt: { lt: monthsAgo(now, retention.signInEvents) } } })).count;
  }
  for (const [key, purpose] of [["importFiles", "IMPORT"], ["exportFiles", "EXPORT"]] as const) {
    const days = retention[key];
    if (!days) continue;
    const inUse = key === "importFiles" ? (await adminDb.importSession.findMany({ where: { organizationId, status: { in: ["QUEUED", "IMPORTING"] }, fileId: { not: null } }, select: { fileId: true } })).map((s) => s.fileId!) : [];
    const due = await adminDb.file.findMany({ where: { organizationId, purpose, status: { not: "DELETED" }, createdAt: { lt: daysAgo(now, days) }, id: { notIn: inUse } }, select: { id: true, storageKey: true }, take: 1000 });
    for (const f of due) {
      await driver.deleteObject(f.storageKey).catch(() => undefined);
      await adminDb.file.update({ where: { id: f.id }, data: { status: "DELETED", deletedAt: now, purgedAt: now } });
    }
    purged[key] = due.length;
  }
  if (retention.syncQueue) {
    purged.syncQueue = (await adminDb.syncMutation.deleteMany({ where: { organizationId, status: { not: "PENDING" }, createdAt: { lt: daysAgo(now, retention.syncQueue) } } })).count;
  }
  if (retention.automationRuns) {
    purged.automationRuns = (await adminDb.automationRun.deleteMany({ where: { organizationId, createdAt: { lt: daysAgo(now, retention.automationRuns) } } })).count;
  }
  if (retention.archivedLeads) {
    purged.archivedLeads = (await adminDb.lead.deleteMany({ where: { organizationId, archivedAt: { lt: monthsAgo(now, retention.archivedLeads) } } })).count;
  }
  if (retention.archivedTasks) {
    purged.archivedTasks = (await adminDb.task.deleteMany({ where: { organizationId, archivedAt: { lt: monthsAgo(now, retention.archivedTasks) } } })).count;
  }
  if (Object.values(purged).some((n) => n > 0)) {
    await recordAuditEvent({ organizationId, action: "retention.purged", entityType: "Organization", entityId: organizationId, metadata: purged as Prisma.InputJsonValue });
  }
  return { purged };
}

