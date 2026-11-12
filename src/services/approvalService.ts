import type { ApprovalRequest, Prisma } from "@prisma/client";
import { emitTeamActivity } from "./teamActivityNotifier";
import type { AuthContext } from "../auth/context";
import { deny, hasPermission, requireOwnedRecordPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError, type ValidationIssue } from "../auth/errors";
import { assertRecordVisible } from "../auth/visibility";
import { adminDb } from "../db/adminClient";
import { logger } from "../lib/logger";
import { assertWritable } from "../lib/archive";
import {
  DEFAULT_APPROVAL_RULES,
  KIND_LABEL,
  discountNeedsApproval,
  type ApprovalKind,
  type ApprovalRuleSettings,
} from "../lib/approvalRules";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import { isExpiredOn } from "../lib/quotes";
import { sendGenericNotificationEmail } from "../notifications/email";
import {
  createApprovalRequest,
  decidePending,
  findPendingFor,
  findUsableMoveGrant,
  getApprovalRequest,
  pageApprovalRequests,
  markResumed,
  revokeGrant,
} from "../repositories/approvalRequests";
import { recordAuditEvent } from "../repositories/auditEvents";
import { getDealById } from "../repositories/deals";
import { resolveActiveMembership } from "../repositories/memberships";
import { getVersionWithLines, transitionVersion } from "../repositories/quotes";
import { GRANT_DAYS, moveApprovalReason, moveSubjectId } from "./approvalGateService";
import { loadApprovalRules, saveApprovalRules } from "./approvalRuleService";
import { moveDeal } from "./dealRuleService";
import { requireFeature } from "./featureService";
import { confirmErasure, decideExportApproval, updateExportRights } from "./privacyService";
import { loadExportRights } from "./privacySettings";
import { loadQuoteAndDeal, requireQuoteWrite } from "./quoteService";
import { sendQuote, type SendQuoteInput } from "./quoteDocumentService";

/**
 * The approvals engine and its inbox (FIG-1145, B6.13).
 *
 * A rule decides only that an action must WAIT for a person; a person approves or rejects it (hard rule 9). Approvers hold
 * `quotes.approve` (Management). Nobody decides their own request. A rejection needs a reason, and the reason is what the
 * requester reads.
 *
 * What waits, and what happens on approval ("the blocked action resumes by itself"):
 *   DISCOUNT    a quote version whose discount is above the limit. Requesting locks the version (PENDING_APPROVAL). Approved:
 *               the version becomes APPROVED and, when the requester asked for it, the quote is sent to the client address they
 *               gave. Rejected: the version is REJECTED with the reason and the requester makes a new version.
 *   LARGE_DEAL  moving a deal worth more than the limit to a won stage. Approved: the move is made for the requester at once; if
 *               that fails the approval stays a one-use grant for seven days and the requester can repeat the move. Rejected: no move.
 *   EXPORT      the bulk-export approvals of B4.05, listed and decided here through the same service (security.manage).
 *               Approved: the export is started for the requester at once.
 *   DELETION    the second confirmation of a contact erasure (B4.05), listed and decided here. Approved: the erasure runs
 *               (the approver is the second confirmer). Rejected: the request goes back to open.
 * Nothing in an inbox row carries a money amount: titles name the quote, the company and the discount percentage.
 */

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "EXPIRED";
export type ApprovalSource = "REQUEST" | "EXPORT" | "ERASURE";

export interface ApprovalItem {
  id: string;
  source: ApprovalSource;
  kind: ApprovalKind;
  kindLabel: string;
  status: ApprovalStatus;
  title: string;
  summary: string;
  requestedBy: { membershipId: string | null; name: string | null };
  requestedAt: Date;
  requesterNote: string | null;
  decidedBy: { membershipId: string | null; name: string | null } | null;
  decidedAt: Date | null;
  /** What the requester reads when a request is rejected (and the approver's note otherwise). */
  decisionReason: string | null;
  subject: { type: string; id: string; dealId: string | null };
  /** Whether the person asking may decide this one right now. */
  canDecide: boolean;
  /** Set when the action that was waiting could not run by itself after approval; the requester can still do it by hand. */
  resumeError: string | null;
  resumed: boolean;
}

const NOW = () => new Date();

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

async function namesOf(organizationId: string, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return new Map();
  const rows = await adminDb.membership.findMany({ where: { organizationId, id: { in: unique } }, select: { id: true, user: { select: { name: true } } } });
  return new Map(rows.map((m) => [m.id, m.user.name]));
}

async function contextFor(organizationId: string, membershipId: string | null): Promise<AuthContext | null> {
  if (!membershipId) return null;
  const m = await adminDb.membership.findFirst({ where: { id: membershipId, organizationId }, select: { userId: true } });
  return m ? ((await resolveActiveMembership(m.userId, organizationId)) as AuthContext | null) : null;
}

function appLink(slug: string): string {
  return `${(process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")}/o/${slug}/approvals`;
}

/** Best effort, like every notification: a failed email never undoes the request or the decision. Bodies carry no amounts. */
async function emailApprovers(organizationId: string, exceptMembershipId: string | null, title: string, body: string): Promise<void> {
  try {
    const org = await adminDb.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { slug: true } });
    const approvers = await adminDb.membership.findMany({
      where: { organizationId, status: "ACTIVE", role: { rolePermissions: { some: { permission: { key: "quotes.approve" } } } }, ...(exceptMembershipId ? { id: { not: exceptMembershipId } } : {}) },
      select: { user: { select: { email: true } } },
    });
    await Promise.all(approvers.map((a) => sendGenericNotificationEmail(a.user.email, { title, body, link: appLink(org.slug) }).catch((err) => logger.error({ err }, "Approval email failed"))));
  } catch (err) {
    logger.error({ err }, "Could not notify approvers");
  }
}

async function emailRequester(organizationId: string, membershipId: string | null, title: string, body: string): Promise<void> {
  try {
    if (!membershipId) return;
    const [org, m] = await Promise.all([
      adminDb.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { slug: true } }),
      adminDb.membership.findFirst({ where: { id: membershipId, organizationId }, select: { user: { select: { email: true } } } }),
    ]);
    if (m) await sendGenericNotificationEmail(m.user.email, { title, body, link: appLink(org.slug) });
  } catch (err) {
    logger.error({ err }, "Could not notify the requester");
  }
}

// ---------------------------------------------------------------------------
// Rules (Management)
// ---------------------------------------------------------------------------

export async function getApprovalRules(ctx: AuthContext) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  if (!hasPermission(ctx, "configuration.manage") && !hasPermission(ctx, "quotes.approve")) throw deny(ctx, "approval rules (configuration.manage)", ["configuration.manage"]);
  return presentRules(ctx.organizationId);
}

async function presentRules(organizationId: string) {
  const [rules, exportRights] = await Promise.all([loadApprovalRules(organizationId), loadExportRights(organizationId)]);
  return {
    discount: rules.discount,
    // The export threshold lives with the export rights (B4.05); it is shown and changed here for one place to look.
    export: { enabled: true, thresholdRows: exportRights.approvalThreshold },
    largeDeal: rules.largeDeal,
    // Permanent deletion always needs a second person; it cannot be switched off.
    deletion: { enabled: true, locked: true },
    defaults: { discount: DEFAULT_APPROVAL_RULES.discount, largeDeal: DEFAULT_APPROVAL_RULES.largeDeal },
  };
}

export interface ApprovalRulesPatch {
  discount?: { enabled?: boolean; thresholdPercent?: number };
  export?: { thresholdRows?: number };
  largeDeal?: { enabled?: boolean; thresholdAmount?: number; currency?: string };
  deletion?: { enabled?: boolean };
}

export async function updateApprovalRules(ctx: AuthContext, patch: ApprovalRulesPatch) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  requirePermission(ctx, "configuration.manage");
  const issues: ValidationIssue[] = [];
  const before = await loadApprovalRules(ctx.organizationId);
  const next: ApprovalRuleSettings = JSON.parse(JSON.stringify(before));
  if (patch.discount) {
    if (patch.discount.enabled !== undefined) next.discount.enabled = patch.discount.enabled;
    if (patch.discount.thresholdPercent !== undefined) {
      const t = patch.discount.thresholdPercent;
      if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > 30) issues.push({ path: "discount.thresholdPercent", message: "A percentage from 0 to 30: above 30% a quote can never be sent anyway.", code: "INVALID_THRESHOLD" });
      else next.discount.thresholdPercent = t;
    }
  }
  if (patch.largeDeal) {
    if (patch.largeDeal.enabled !== undefined) next.largeDeal.enabled = patch.largeDeal.enabled;
    if (patch.largeDeal.thresholdAmount !== undefined) {
      const t = patch.largeDeal.thresholdAmount;
      if (typeof t !== "number" || !Number.isFinite(t) || t <= 0 || t > 999_999_999_999) issues.push({ path: "largeDeal.thresholdAmount", message: "An amount more than zero.", code: "INVALID_THRESHOLD" });
      else next.largeDeal.thresholdAmount = t;
    }
    if (patch.largeDeal.currency !== undefined) {
      if (!/^[A-Z]{3}$/.test(patch.largeDeal.currency)) issues.push({ path: "largeDeal.currency", message: "Use a three-letter currency code such as KES.", code: "INVALID_CURRENCY" });
      else next.largeDeal.currency = patch.largeDeal.currency;
    }
  }
  if (patch.deletion?.enabled === false) issues.push({ path: "deletion.enabled", message: "Permanent deletion always needs a second person. It cannot be switched off.", code: "RULE_LOCKED" });
  if (issues.length > 0) throw new ValidationError("These approval rules are not valid.", issues);

  if (patch.export?.thresholdRows !== undefined) await updateExportRights(ctx, { approvalThreshold: patch.export.thresholdRows });
  await saveApprovalRules(ctx.organizationId, next);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "approval_rules.updated",
    entityType: "Organization",
    entityId: ctx.organizationId,
    previousValue: before as unknown as Prisma.InputJsonValue,
    newValue: next as unknown as Prisma.InputJsonValue,
  });
  return presentRules(ctx.organizationId);
}

// ---------------------------------------------------------------------------
// Presenting
// ---------------------------------------------------------------------------

function presentRow(ctx: AuthContext, row: ApprovalRequest, names: Map<string, string>, now: Date): ApprovalItem {
  const kind = row.kind as ApprovalKind;
  const detail = (row.detail ?? {}) as Record<string, unknown>;
  const expired = row.status === "APPROVED" && row.expiresAt !== null && row.expiresAt <= now && row.consumedAt === null && row.resumedAt === null;
  const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  return {
    id: row.id,
    source: "REQUEST",
    kind,
    kindLabel: KIND_LABEL[kind],
    status: expired ? "EXPIRED" : (row.status as ApprovalStatus),
    title: row.title,
    summary: typeof detail.summary === "string" ? detail.summary : "",
    requestedBy: { membershipId: row.requestedByMembershipId, name: name(row.requestedByMembershipId) },
    requestedAt: row.createdAt,
    requesterNote: row.requesterNote,
    decidedBy: row.decidedByMembershipId ? { membershipId: row.decidedByMembershipId, name: name(row.decidedByMembershipId) } : null,
    decidedAt: row.decidedAt,
    decisionReason: row.decisionReason,
    subject: { type: row.subjectType, id: row.subjectId, dealId: row.dealId },
    canDecide: row.status === "PENDING" && hasPermission(ctx, "quotes.approve") && row.requestedByMembershipId !== ctx.membershipId,
    resumeError: row.resumeError,
    resumed: row.resumedAt !== null,
  };
}

type ExportRow = Awaited<ReturnType<typeof adminDb.exportApproval.findMany>>[number];
type ErasureRow = Awaited<ReturnType<typeof adminDb.dataSubjectRequest.findMany>>[number];

function exportItems(ctx: AuthContext, rows: ExportRow[], names: Map<string, string>, now: Date): ApprovalItem[] {
  return rows.map((a) => {
    const expired = a.status === "APPROVED" && a.expiresAt !== null && a.expiresAt <= now;
    const status: ApprovalStatus = a.status === "PENDING" ? "PENDING" : a.status === "REJECTED" ? "REJECTED" : expired ? "EXPIRED" : "APPROVED";
    return {
      id: a.id,
      source: "EXPORT" as const,
      kind: "EXPORT" as const,
      kindLabel: KIND_LABEL.EXPORT,
      status,
      title: `${a.entity.charAt(0)}${a.entity.slice(1).toLowerCase()} export, ${a.rowCount.toLocaleString("en-KE")} rows`,
      summary: "An export larger than the row limit needs approval.",
      requestedBy: { membershipId: a.requestedByMembershipId, name: names.get(a.requestedByMembershipId) ?? null },
      requestedAt: a.createdAt,
      requesterNote: a.reason,
      decidedBy: a.decidedByMembershipId ? { membershipId: a.decidedByMembershipId, name: names.get(a.decidedByMembershipId) ?? null } : null,
      decidedAt: a.decidedAt,
      decisionReason: a.decisionNote,
      subject: { type: "EXPORT", id: a.id, dealId: null },
      canDecide: a.status === "PENDING" && hasPermission(ctx, "security.manage") && a.requestedByMembershipId !== ctx.membershipId,
      resumeError: null,
      resumed: a.status === "USED",
    };
  });
}

// Erasure rows carry a person's name, so callers pass them only to people who handle privacy requests.
function erasureItems(ctx: AuthContext, rows: ErasureRow[]): ApprovalItem[] {
  return rows.map((r) => ({
    id: r.id,
    source: "ERASURE" as const,
    kind: "DELETION" as const,
    kindLabel: KIND_LABEL.DELETION,
    status: "PENDING" as const,
    title: `Contact erasure: ${r.subjectLabel}`,
    summary: "Data-protection request: permanent deletion needs a second person.",
    requestedBy: { membershipId: r.firstConfirmedByMembershipId, name: null },
    requestedAt: r.firstConfirmedAt ?? r.createdAt,
    // The evidence notes may hold personal details; they stay on the privacy screen.
    requesterNote: null,
    decidedBy: null,
    decidedAt: null,
    decisionReason: null,
    subject: { type: "DATA_SUBJECT_REQUEST", id: r.id, dealId: null },
    canDecide: r.firstConfirmedByMembershipId !== ctx.membershipId,
    resumeError: null,
    resumed: false,
  }));
}

/**
 * The inbox. Approvers (`quotes.approve`) see every request waiting for them and the history; everybody else sees only their own
 * requests, read-only, with the reason when one was rejected.
 */
export async function listApprovals(
  ctx: AuthContext,
  filters: { status?: string; kind?: string; mine?: boolean } = {},
  request: PageRequest = {},
  now = NOW(),
) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  const isApprover = hasPermission(ctx, "quotes.approve");
  if (!isApprover && !hasPermission(ctx, "quotes.create")) throw deny(ctx, "approvals (quotes.approve, or quotes.create for your own requests)", ["quotes.approve", "quotes.create"]);
  if (filters.status && !["PENDING", "APPROVED", "REJECTED", "CANCELLED", "EXPIRED"].includes(filters.status)) throw new ValidationError("status is not an approval status.", [{ path: "status", message: "Use PENDING, APPROVED, REJECTED, CANCELLED or EXPIRED." }]);
  if (filters.kind && !["DISCOUNT", "EXPORT", "DELETION", "LARGE_DEAL"].includes(filters.kind)) throw new ValidationError("kind is not an approval kind.", [{ path: "kind", message: "Use DISCOUNT, EXPORT, DELETION or LARGE_DEAL." }]);
  const own = !isApprover || filters.mine === true;
  const paging = resolvePaging(request);
  const want = paging.skip + paging.take;

  // Filters run in the database. Each source gives at most the rows the requested page can need, plus its own count.
  const orgId = ctx.organizationId;
  const mineReq = own ? { requestedByMembershipId: ctx.membershipId } : {};
  const expiredReq: Prisma.ApprovalRequestWhereInput = { status: "APPROVED", expiresAt: { lte: now }, consumedAt: null, resumedAt: null };
  const expiredExp: Prisma.ExportApprovalWhereInput = { status: "APPROVED", expiresAt: { lte: now } };
  const st = filters.status;
  const reqStatus: Prisma.ApprovalRequestWhereInput = !st ? {} : st === "EXPIRED" ? expiredReq : st === "APPROVED" ? { status: "APPROVED", NOT: expiredReq } : { status: st };
  const expStatus: Prisma.ExportApprovalWhereInput = !st ? {} : st === "PENDING" || st === "REJECTED" ? { status: st } : st === "CANCELLED" ? { id: "" } : st === "EXPIRED" ? expiredExp : { status: { notIn: ["PENDING", "REJECTED"] }, NOT: expiredExp };
  const reqWhere: Prisma.ApprovalRequestWhereInput = { organizationId: orgId, ...mineReq, ...reqStatus, ...(filters.kind ? { kind: filters.kind } : {}) };
  const expWhere: Prisma.ExportApprovalWhereInput = { organizationId: orgId, ...(own ? { requestedByMembershipId: ctx.membershipId } : {}), ...expStatus };
  const eraseWhere: Prisma.DataSubjectRequestWhereInput = { organizationId: orgId, kind: "ERASURE", status: "AWAITING_SECOND_CONFIRMATION" };
  const wantExport = !filters.kind || filters.kind === "EXPORT";
  const wantErasure = !own && hasPermission(ctx, "security.manage") && (!filters.kind || filters.kind === "DELETION") && (!st || st === "PENDING");
  const countPending = !st || st === "PENDING";

  const [reqPage, expRows, expTotal, expPending, eraseRows, eraseTotal, reqPending] = await Promise.all([
    pageApprovalRequests(orgId, reqWhere, want),
    wantExport ? adminDb.exportApproval.findMany({ where: expWhere, orderBy: { createdAt: "desc" }, take: want }) : Promise.resolve([] as ExportRow[]),
    wantExport ? adminDb.exportApproval.count({ where: expWhere }) : Promise.resolve(0),
    wantExport && countPending ? adminDb.exportApproval.count({ where: { ...expWhere, status: "PENDING" } }) : Promise.resolve(0),
    wantErasure ? adminDb.dataSubjectRequest.findMany({ where: eraseWhere, orderBy: { createdAt: "desc" }, take: want }) : Promise.resolve([] as ErasureRow[]),
    wantErasure ? adminDb.dataSubjectRequest.count({ where: eraseWhere }) : Promise.resolve(0),
    countPending ? pageApprovalRequests(orgId, { ...reqWhere, status: "PENDING" }, 0) : Promise.resolve({ rows: [], total: 0 }),
  ]);
  const names = await namesOf(orgId, [...reqPage.rows.flatMap((x) => [x.requestedByMembershipId, x.decidedByMembershipId]), ...expRows.flatMap((x) => [x.requestedByMembershipId, x.decidedByMembershipId])]);
  const items = [...reqPage.rows.map((x) => presentRow(ctx, x, names, now)), ...exportItems(ctx, expRows, names, now), ...erasureItems(ctx, eraseRows)].sort(
    (x, y) => y.requestedAt.getTime() - x.requestedAt.getTime() || x.id.localeCompare(y.id),
  );
  const total = reqPage.total + expTotal + eraseTotal;
  const page = buildPage(items.slice(paging.skip, paging.skip + paging.take), total, paging);
  return { ...page, pending: reqPending.total + expPending + eraseTotal, canDecide: isApprover };
}

export async function getApproval(ctx: AuthContext, id: string, now = NOW()) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  const isApprover = hasPermission(ctx, "quotes.approve");
  const row = await getApprovalRequest(ctx.organizationId, id);
  if (row) {
    if (!isApprover && row.requestedByMembershipId !== ctx.membershipId) throw new NotFoundError("ApprovalRequest", id);
    const names = await namesOf(ctx.organizationId, [row.requestedByMembershipId, row.decidedByMembershipId]);
    return presentRow(ctx, row, names, now);
  }
  // Export approvals and erasure confirmations are read by id, never by scanning a page.
  if (!isApprover && !hasPermission(ctx, "quotes.create")) throw deny(ctx, "approvals (quotes.approve, or quotes.create for your own requests)", ["quotes.approve", "quotes.create"]);
  const own = !isApprover;
  const exp = await adminDb.exportApproval.findFirst({ where: { id, organizationId: ctx.organizationId, ...(own ? { requestedByMembershipId: ctx.membershipId } : {}) } });
  if (exp) {
    const names = await namesOf(ctx.organizationId, [exp.requestedByMembershipId, exp.decidedByMembershipId]);
    return exportItems(ctx, [exp], names, now)[0]!;
  }
  if (!own && hasPermission(ctx, "security.manage")) {
    const er = await adminDb.dataSubjectRequest.findFirst({ where: { id, organizationId: ctx.organizationId, kind: "ERASURE", status: "AWAITING_SECOND_CONFIRMATION" } });
    if (er) return erasureItems(ctx, [er])[0]!;
  }
  throw new NotFoundError("ApprovalRequest", id);
}

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

const clip = (text: string | undefined, max = 500) => (text ?? "").trim().slice(0, max) || null;

export interface RequestDiscountApprovalInput {
  note?: string;
  /** Send the quote to this client address by itself once it is approved. */
  sendOnApproval?: SendQuoteInput;
}

/** Locks a quote version whose discount is above the limit and asks the approvers. */
export async function requestDiscountApproval(ctx: AuthContext, quoteId: string, version: number, input: RequestDiscountApprovalInput = {}, now = NOW()) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  const { quote, deal } = await loadQuoteAndDeal(ctx, quoteId);
  requireQuoteWrite(ctx, deal);
  assertWritable(ctx, "deal", deal, "asking for approval");
  const row = await getVersionWithLines(ctx.organizationId, quoteId, version);
  if (!row) throw new NotFoundError("QuoteVersion", `${quoteId}/${version}`);
  const fail = (message: string, code: string, path = "version") => new ValidationError(message, [{ path, message, code }]);

  if (row.status === "PENDING_APPROVAL") {
    const existing = await findPendingFor(ctx.organizationId, "DISCOUNT", "QUOTE_VERSION", row.id);
    if (existing) return presentRow(ctx, existing, await namesOf(ctx.organizationId, [existing.requestedByMembershipId]), now);
  }
  if (row.status !== "DRAFT") throw fail("Only a draft version can be sent for approval.", "NOT_DRAFT");
  if (row.lines.length === 0) throw fail("Add at least one line before asking for approval.", "NO_LINES", "lines");
  if (isExpiredOn(row.validUntil.toISOString().slice(0, 10), now)) throw fail("This quote has passed its validity date. Change the date first.", "QUOTE_EXPIRED", "validUntil");
  const rules = await loadApprovalRules(ctx.organizationId);
  const pct = Number(row.discountPercent);
  if (!discountNeedsApproval(pct, rules)) throw fail("This discount is within the limit, so it needs no approval. Send the quote.", "APPROVAL_NOT_NEEDED", "discountPercent");

  const locked = await transitionVersion(ctx.organizationId, row.id, ["DRAFT"], "PENDING_APPROVAL", { lock: true, submittedAt: now });
  if (!locked) throw fail("This version was changed by someone else. Reload and try again.", "CONFLICT");
  const created = await createApprovalRequest({
    organizationId: ctx.organizationId,
    kind: "DISCOUNT",
    subjectType: "QUOTE_VERSION",
    subjectId: row.id,
    dealId: deal.id,
    title: `${quote.number} v${row.version}: ${pct}% discount`,
    detail: {
      summary: `A ${pct}% discount is above the ${rules.discount.thresholdPercent}% that needs approval.`,
      quoteId,
      quoteNumber: quote.number,
      version: row.version,
      discountPercent: pct,
      thresholdPercent: rules.discount.thresholdPercent,
      ...(input.sendOnApproval ? { sendOnApproval: input.sendOnApproval as unknown as Prisma.InputJsonValue } : {}),
    } as Prisma.InputJsonValue,
    requestedByMembershipId: ctx.membershipId,
    requesterNote: clip(input.note),
  });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "approval.requested", entityType: "ApprovalRequest", entityId: created.id, metadata: { kind: "DISCOUNT", quote: quote.number, version: row.version, discountPercent: pct } });
  await emitTeamActivity({ organizationId: ctx.organizationId, eventKey: "DISCOUNT_REQUESTED", actorMembershipId: ctx.membershipId, entityType: "ApprovalRequest", entityId: created.id, label: `${quote.number} v${row.version}: ${pct}%`, route: "approvals", detail: { summary: `A ${pct}% discount is above the ${rules.discount.thresholdPercent}% that needs approval.` } });
  await emailApprovers(ctx.organizationId, ctx.membershipId, "A discount needs your approval", `${quote.number} version ${row.version} has a ${pct}% discount. Open the approvals inbox to decide.`);
  return presentRow(ctx, created, await namesOf(ctx.organizationId, [ctx.membershipId]), now);
}

/** Asks the approvers to let a deal above the large-deal limit be marked won. The move itself happens after approval. */
export async function requestDealMoveApproval(ctx: AuthContext, dealId: string, input: { pipelineStageId: string; note?: string }, now = NOW()) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  const deal = await getDealById(ctx.organizationId, dealId);
  if (!deal) throw new NotFoundError("Deal", dealId);
  assertRecordVisible(ctx, "deals", "Deal", dealId, deal);
  requireOwnedRecordPermission(ctx, "deals.edit.own", "deals.edit.all", deal.ownerMembershipId);
  assertWritable(ctx, "deal", deal, "asking for approval");
  const stage = await adminDb.pipelineStage.findFirst({ where: { id: input.pipelineStageId, organizationId: ctx.organizationId } });
  const fail = (message: string, code: string, path = "pipelineStageId") => new ValidationError(message, [{ path, message, code }]);
  if (!stage) throw fail("That pipeline stage does not exist.", "STAGE_NOT_FOUND");
  const rules = await loadApprovalRules(ctx.organizationId);
  const reason = await moveApprovalReason(ctx.organizationId, deal, stage);
  if (!reason) throw fail("This move needs no approval.", "APPROVAL_NOT_NEEDED");
  const subjectId = moveSubjectId(dealId, stage.id);
  const usable = await findUsableMoveGrant(ctx.organizationId, dealId, stage.id, now, { value: deal.value === null ? null : Number(deal.value), currency: deal.currency }, { membershipId: ctx.membershipId, canEditAll: hasPermission(ctx, "deals.edit.all") });
  if (usable) return presentRow(ctx, usable, await namesOf(ctx.organizationId, [usable.requestedByMembershipId, usable.decidedByMembershipId]), now);
  const existing = await findPendingFor(ctx.organizationId, "LARGE_DEAL", "DEAL_MOVE", subjectId);
  if (existing) return presentRow(ctx, existing, await namesOf(ctx.organizationId, [existing.requestedByMembershipId]), now);
  const company = await adminDb.company.findFirst({ where: { id: deal.companyId, organizationId: ctx.organizationId }, select: { name: true } });
  const created = await createApprovalRequest({
    organizationId: ctx.organizationId,
    kind: "LARGE_DEAL",
    subjectType: "DEAL_MOVE",
    subjectId,
    dealId,
    title: `${company?.name ?? "Deal"}: ${stage.isWon ? "mark won" : `move to ${stage.name}`}`,
    detail: { summary: reason.why === "THRESHOLD" ? `A deal above the ${rules.largeDeal.currency} ${rules.largeDeal.thresholdAmount.toLocaleString("en-KE")} limit needs approval before it is marked won.` : `${stage.name} needs approval before a deal can move there.`, toStageId: stage.id, toStageName: stage.name } as Prisma.InputJsonValue,
    requestedByMembershipId: ctx.membershipId,
    requesterNote: clip(input.note),
    // The grant is for the deal as it is now: an edit of the value or currency before the move voids it.
    grantValue: deal.value,
    grantCurrency: deal.currency,
  });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "approval.requested", entityType: "ApprovalRequest", entityId: created.id, metadata: { kind: "LARGE_DEAL", dealId, toStageId: stage.id } });
  await emailApprovers(ctx.organizationId, ctx.membershipId, "A won deal needs your approval", `${company?.name ?? "A deal"} is waiting to be marked won. Open the approvals inbox to decide.`);
  return presentRow(ctx, created, await namesOf(ctx.organizationId, [ctx.membershipId]), now);
}

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

export interface DecisionInput {
  approve: boolean;
  reason?: string;
}

function requireReason(input: DecisionInput): string | null {
  const reason = clip(input.reason);
  if (!input.approve && (!reason || reason.length < 3)) {
    throw new ValidationError("Give a reason so the requester knows why.", [{ path: "reason", message: "A rejection needs a reason of at least 3 characters.", code: "REASON_REQUIRED" }]);
  }
  return reason;
}

export async function decideApproval(ctx: AuthContext, id: string, input: DecisionInput, now = NOW()): Promise<ApprovalItem> {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  const reason = requireReason(input);
  const row = await getApprovalRequest(ctx.organizationId, id);
  if (row) return decideRequest(ctx, row, input, reason, now);

  // Export approvals and erasure confirmations are decided through their own services, so their rules apply unchanged.
  const exportApproval = await adminDb.exportApproval.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (exportApproval) {
    await decideExportApproval(ctx, id, { approve: input.approve, note: reason ?? undefined }, now);
    if (input.approve) await resumeExport(ctx.organizationId, exportApproval);
    await emailRequester(ctx.organizationId, exportApproval.requestedByMembershipId, input.approve ? "Your export was approved" : "Your export was not approved", input.approve ? "You can download it from your exports shortly." : `Reason: ${reason}`);
    return getApproval(ctx, id, now);
  }
  const erasure = await adminDb.dataSubjectRequest.findFirst({ where: { id, organizationId: ctx.organizationId, kind: "ERASURE" } });
  if (erasure) return decideErasure(ctx, erasure, input, reason, now);
  throw new NotFoundError("ApprovalRequest", id);
}

async function decideRequest(ctx: AuthContext, row: ApprovalRequest, input: DecisionInput, reason: string | null, now: Date): Promise<ApprovalItem> {
  requirePermission(ctx, "quotes.approve");
  if (row.requestedByMembershipId === ctx.membershipId) {
    throw new ValidationError("Someone else has to decide your own request.", [{ path: "id", message: "A different approver must decide.", code: "SELF_APPROVAL" }]);
  }
  // An approver can take back a deal-move approval that has not been used yet (a rejection with a reason).
  if (row.status === "APPROVED" && row.subjectType === "DEAL_MOVE" && !input.approve && row.consumedAt === null) {
    if (!(await revokeGrant(ctx.organizationId, row.id, now))) throw new ValidationError("This approval was already used.", [{ path: "id", message: "Already used.", code: "ALREADY_DECIDED" }]);
    await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "approval.revoked", entityType: "ApprovalRequest", entityId: row.id, metadata: { kind: row.kind, dealId: row.dealId, hasReason: reason !== null } });
    await emailRequester(ctx.organizationId, row.requestedByMembershipId, `Approval withdrawn: ${row.title}`, `The approval was taken back. Reason: ${reason}`);
    const names = await namesOf(ctx.organizationId, [row.requestedByMembershipId, row.decidedByMembershipId]);
    return presentRow(ctx, (await getApprovalRequest(ctx.organizationId, row.id)) ?? row, names, now);
  }
  const status = input.approve ? "APPROVED" : "REJECTED";
  const decided = await decidePending(
    ctx.organizationId,
    row.id,
    status,
    { decidedByMembershipId: ctx.membershipId, decisionReason: reason, expiresAt: input.approve && row.subjectType === "DEAL_MOVE" ? new Date(now.getTime() + GRANT_DAYS * 86_400_000) : null },
    now,
  );
  if (!decided) throw new ValidationError("This request was already decided.", [{ path: "id", message: "Already decided.", code: "ALREADY_DECIDED" }]);
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: input.approve ? "approval.approved" : "approval.rejected", entityType: "ApprovalRequest", entityId: row.id, metadata: { kind: row.kind, dealId: row.dealId, hasReason: reason !== null } });

  const detail = (row.detail ?? {}) as Record<string, unknown>;
  if (row.kind === "DISCOUNT") {
    const moved = await transitionVersion(ctx.organizationId, row.subjectId, ["PENDING_APPROVAL"], status, { decidedByMembershipId: ctx.membershipId, decisionReason: reason, ...(input.approve ? { approvedAt: now } : {}) });
    if (!moved) logger.error({ requestId: row.id }, "Approved quote version was not pending");
    else if (input.approve && detail.sendOnApproval) await resumeSend(row, detail);
  } else if (row.kind === "LARGE_DEAL" && input.approve) {
    await resumeMove(row, detail);
  }
  await emailRequester(
    ctx.organizationId,
    row.requestedByMembershipId,
    input.approve ? `Approved: ${row.title}` : `Not approved: ${row.title}`,
    input.approve ? "Your request was approved." : `Your request was not approved. Reason: ${reason}`,
  );
  const names = await namesOf(ctx.organizationId, [decided.requestedByMembershipId, decided.decidedByMembershipId]);
  const fresh = (await getApprovalRequest(ctx.organizationId, row.id)) ?? decided;
  return presentRow(ctx, fresh, names, now);
}

/** The quote goes to the client by itself, sent as the person who asked. A failure leaves it APPROVED for them to send by hand. */
async function resumeSend(row: ApprovalRequest, detail: Record<string, unknown>): Promise<void> {
  const now = NOW();
  try {
    const requester = await contextFor(row.organizationId, row.requestedByMembershipId);
    if (!requester) throw new Error("The person who asked can no longer send it.");
    await sendQuote(requester, String(detail.quoteId), Number(detail.version), detail.sendOnApproval as SendQuoteInput, now);
    await markResumed(row.organizationId, row.id, null, now);
  } catch (err) {
    logger.error({ err, requestId: row.id }, "Could not send the approved quote");
    await markResumed(row.organizationId, row.id, err instanceof Error ? err.message : "Could not send the quote.", now);
  }
}

/** The move is made for the person who asked. A failure leaves the approval as a one-use grant they can still use. */
async function resumeMove(row: ApprovalRequest, detail: Record<string, unknown>): Promise<void> {
  const now = NOW();
  try {
    const requester = await contextFor(row.organizationId, row.requestedByMembershipId);
    if (!requester || !row.dealId) throw new Error("The person who asked can no longer move the deal.");
    await moveDeal(requester, row.dealId, { pipelineStageId: String(detail.toStageId) });
    await markResumed(row.organizationId, row.id, null, now);
  } catch (err) {
    logger.error({ err, requestId: row.id }, "Could not make the approved move");
    await markResumed(row.organizationId, row.id, err instanceof Error ? err.message : "Could not make the move.", now);
  }
}

async function resumeExport(organizationId: string, approval: { id: string; entity: string; filters: unknown; requestedByMembershipId: string }): Promise<void> {
  try {
    const requester = await contextFor(organizationId, approval.requestedByMembershipId);
    if (!requester) return;
    const { startExport } = await import("./dataRunService");
    await startExport(requester, { entity: approval.entity as "LEAD" | "CONTACT" | "COMPANY" | "DEAL", filters: (approval.filters ?? {}) as Record<string, unknown>, approvalId: approval.id });
  } catch (err) {
    // The approval stays usable: the requester can start the export themselves.
    logger.error({ err, approvalId: approval.id }, "Could not start the approved export");
  }
}

async function decideErasure(ctx: AuthContext, row: { id: string; status: string; firstConfirmedByMembershipId: string | null; requestedByMembershipId: string | null }, input: DecisionInput, reason: string | null, now: Date): Promise<ApprovalItem> {
  requirePermission(ctx, "security.manage");
  if (row.status !== "AWAITING_SECOND_CONFIRMATION") throw new ValidationError("This request is not waiting for a second person.", [{ path: "id", message: "Not waiting for approval.", code: "NOT_PENDING" }]);
  if (input.approve) {
    await confirmErasure(ctx, row.id, now);
    return {
      id: row.id, source: "ERASURE", kind: "DELETION", kindLabel: KIND_LABEL.DELETION, status: "APPROVED", title: "Contact erasure", summary: "The contact was erased.",
      requestedBy: { membershipId: row.firstConfirmedByMembershipId, name: null }, requestedAt: now, requesterNote: null, decidedBy: { membershipId: ctx.membershipId, name: null }, decidedAt: now,
      decisionReason: reason, subject: { type: "DATA_SUBJECT_REQUEST", id: row.id, dealId: null }, canDecide: false, resumeError: null, resumed: true,
    };
  }
  if (row.firstConfirmedByMembershipId === ctx.membershipId) {
    throw new ValidationError("Someone else has to decide your own request.", [{ path: "id", message: "A different approver must decide.", code: "SELF_APPROVAL" }]);
  }
  // A rejection puts the request back to open: nothing is erased, and the first confirmation is cleared so it starts again.
  await adminDb.dataSubjectRequest.update({ where: { id: row.id }, data: { status: "OPEN", firstConfirmedByMembershipId: null, firstConfirmedAt: null, evidenceNotes: undefined } });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "data_subject_request.erasure_rejected", entityType: "DataSubjectRequest", entityId: row.id, metadata: { hasReason: true } });
  await emailRequester(ctx.organizationId, row.firstConfirmedByMembershipId, "A contact erasure was not approved", `Reason: ${reason}`);
  return {
    id: row.id, source: "ERASURE", kind: "DELETION", kindLabel: KIND_LABEL.DELETION, status: "REJECTED", title: "Contact erasure", summary: "Not approved. The request is open again.",
    requestedBy: { membershipId: row.firstConfirmedByMembershipId, name: null }, requestedAt: now, requesterNote: null, decidedBy: { membershipId: ctx.membershipId, name: null }, decidedAt: now,
    decisionReason: reason, subject: { type: "DATA_SUBJECT_REQUEST", id: row.id, dealId: null }, canDecide: false, resumeError: null, resumed: false,
  };
}

/** The person who asked withdraws a waiting request. A waiting quote version becomes REJECTED (withdrawn) so a new version can be made. */
export async function cancelApproval(ctx: AuthContext, id: string, now = NOW()) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  const row = await getApprovalRequest(ctx.organizationId, id);
  if (!row || row.requestedByMembershipId !== ctx.membershipId) throw new NotFoundError("ApprovalRequest", id);
  const reason = "Withdrawn by the requester.";
  const done = await decidePending(ctx.organizationId, id, "CANCELLED", { decidedByMembershipId: ctx.membershipId, decisionReason: reason }, now);
  if (!done) throw new ValidationError("Only a waiting request can be withdrawn.", [{ path: "id", message: "Already decided.", code: "ALREADY_DECIDED" }]);
  if (row.kind === "DISCOUNT") await transitionVersion(ctx.organizationId, row.subjectId, ["PENDING_APPROVAL"], "REJECTED", { decidedByMembershipId: ctx.membershipId, decisionReason: reason });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "approval.cancelled", entityType: "ApprovalRequest", entityId: id, metadata: { kind: row.kind } });
  return presentRow(ctx, done, await namesOf(ctx.organizationId, [done.requestedByMembershipId, done.decidedByMembershipId]), now);
}
