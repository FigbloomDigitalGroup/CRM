import type { LeadPoolRequestStatus } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { cleanArchiveReason } from "../lib/archive";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import { recordAuditEvent } from "../repositories/auditEvents";
import { getLeadById, takeUnassignedLead } from "../repositories/leads";
import {
  createPoolRequest,
  decidePoolRequest,
  findPendingRequest,
  getPoolRequest,
  listPoolRequests,
  supersedePendingForLead,
} from "../repositories/leadPoolRequests";
import { listLeadsPage } from "./leadService";
import { notifyLeadAssigned, notifyLeadPool } from "./notificationService";
import { assertEligibleLeadOwner } from "./ownerEligibility";

/**
 * The shared pool of unassigned leads and "Ask to take" (FIG-1031, B2.02,
 * provisional departure `departure.shared_pool`).
 *
 *   pool    : unassigned, open leads. Sales sees the pool (and only the pool, besides
 *             their own leads) with `leads.view.shared`, which exists only while the
 *             departure is on; Management sees it through `leads.view.all`.
 *   ask     : a salesperson asks to take one. In the default `approval` mode
 *             Management is notified and approves or declines (with a reason);
 *             in `auto` mode the first request wins at once.
 *   rules   : a taken lead is the taker's own immediately; a declined request leaves the
 *             lead in the pool; a lead that already has an owner cannot be asked for;
 *             two people asking at once cannot both get it (conditional update).
 */

export const POOL_MODE_KEY = "lead_pool.mode";
export type PoolMode = "approval" | "auto";

export async function getPoolMode(organizationId: string): Promise<PoolMode> {
  const row = await adminDb.organizationSetting.findUnique({ where: { organizationId_key: { organizationId, key: POOL_MODE_KEY } } });
  const mode = (row?.value as { mode?: string } | null)?.mode;
  return mode === "auto" ? "auto" : "approval";
}

export async function setPoolMode(ctx: AuthContext, mode: PoolMode) {
  requirePermission(ctx, "configuration.manage");
  if (mode !== "approval" && mode !== "auto") {
    throw new ValidationError("Choose approval or auto.", [{ path: "mode", message: "Use approval or auto." }]);
  }
  const previous = await getPoolMode(ctx.organizationId);
  await adminDb.organizationSetting.upsert({
    where: { organizationId_key: { organizationId: ctx.organizationId, key: POOL_MODE_KEY } },
    update: { value: { mode } },
    create: { organizationId: ctx.organizationId, key: POOL_MODE_KEY, value: { mode } },
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "lead_pool.mode_changed",
    entityType: "Organization",
    entityId: ctx.organizationId,
    previousValue: { mode: previous },
    newValue: { mode },
  });
  return { mode };
}

function canSeePool(ctx: AuthContext): boolean {
  return hasPermission(ctx, "leads.view.all") || hasPermission(ctx, "leads.view.shared");
}

/** The pool: open leads with no owner. Nobody gets another person's lead through it. */
export async function listPool(ctx: AuthContext, filters: { query?: string } = {}, request: PageRequest = {}) {
  if (!canSeePool(ctx)) requirePermission(ctx, "leads.view.shared");
  const page = await listPoolPage(ctx, filters, request);
  const mine = await adminDb.leadPoolRequest.findMany({
    where: { organizationId: ctx.organizationId, requesterMembershipId: ctx.membershipId, status: "PENDING", leadId: { in: page.items.map((l) => l.id) } },
    select: { leadId: true, id: true },
  });
  const pending = new Map(mine.map((r) => [r.leadId, r.id]));
  return { ...page, items: page.items.map((lead) => ({ ...lead, myPendingRequestId: pending.get(lead.id) ?? null })) };
}

async function listPoolPage(ctx: AuthContext, filters: { query?: string }, request: PageRequest) {
  // The pool filter is applied after the caller's own scoping, so a role that can only see
  // "own or unassigned" leads gets the unassigned ones and nothing more.
  return listLeadsPage(ctx, { query: filters.query, unassignedOnly: true }, request);
}

async function managementRecipients(organizationId: string, exceptMembershipId?: string) {
  const members = await adminDb.membership.findMany({
    where: { organizationId, status: "ACTIVE", role: { rolePermissions: { some: { permission: { key: "leads.assign" } } } } },
    select: { id: true },
  });
  return members.map((m) => m.id).filter((id) => id !== exceptMembershipId);
}

function leadLabel(lead: { company?: { name: string } | null; contact?: { firstName: string; lastName: string | null } | null }) {
  if (lead.company?.name) return lead.company.name;
  if (lead.contact) return [lead.contact.firstName, lead.contact.lastName].filter(Boolean).join(" ");
  return "an unnamed lead";
}

async function requesterName(organizationId: string, membershipId: string) {
  const m = await adminDb.membership.findFirst({ where: { id: membershipId, organizationId }, select: { user: { select: { name: true } } } });
  return m?.user.name ?? "A salesperson";
}

/** Makes `membershipId` the owner of the lead if it is still unowned, and tells everyone concerned. */
async function awardLead(ctx: AuthContext, request: { id: string; leadId: string; requesterMembershipId: string }, label: string, how: "approved" | "auto") {
  const won = await takeUnassignedLead(ctx.organizationId, request.leadId, request.requesterMembershipId);
  if (!won) return false;
  await decidePoolRequest(ctx.organizationId, request.id, {
    status: "APPROVED",
    decidedByMembershipId: how === "approved" ? ctx.membershipId : null,
    decisionReason: how === "auto" ? "Taken automatically (the pool is in auto mode)." : null,
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "lead.owner_reassigned",
    entityType: "Lead",
    entityId: request.leadId,
    previousValue: { ownerMembershipId: null },
    newValue: { ownerMembershipId: request.requesterMembershipId },
    metadata: { source: "lead_pool", requestId: request.id, how },
  });
  const others = await supersedePendingForLead(ctx.organizationId, request.leadId, request.id);
  for (const other of others) {
    await notifyLeadPool(ctx.organizationId, other.requesterMembershipId, {
      requestId: other.id,
      leadId: request.leadId,
      title: `Lead already taken: ${label}`,
      body: "Someone else took this lead from the pool before your request was answered.",
    });
  }
  await notifyLeadAssigned(ctx.organizationId, request.requesterMembershipId, { id: request.leadId, label });
  return true;
}

export async function askToTake(ctx: AuthContext, leadId: string, input: { note?: string | null } = {}) {
  // `leads.claim` exists only while the shared-pool departure is on; Management can simply assign.
  if (!hasPermission(ctx, "leads.claim") && !hasPermission(ctx, "leads.assign")) requirePermission(ctx, "leads.claim");
  const lead = await getLeadById(ctx.organizationId, leadId);
  // A lead the caller is not allowed to see in the pool does not exist for them.
  if (!lead || lead.archivedAt || lead.convertedAt) throw new NotFoundError("Lead", leadId);
  if (lead.ownerMembershipId) {
    if (lead.ownerMembershipId === ctx.membershipId) throw new ValidationError("This lead is already yours.");
    throw new ValidationError("This lead already has an owner, so it is not in the pool.", [{ path: "leadId", message: "Already owned.", code: "LEAD_ALREADY_OWNED" }]);
  }
  const note = cleanArchiveReason(input.note);

  const existing = await findPendingRequest(ctx.organizationId, leadId, ctx.membershipId);
  if (existing) return { request: existing, mode: await getPoolMode(ctx.organizationId), taken: false };

  const request = await createPoolRequest({ organizationId: ctx.organizationId, leadId, requesterMembershipId: ctx.membershipId, note });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "lead_pool.requested",
    entityType: "Lead",
    entityId: leadId,
    metadata: { requestId: request.id, note },
  });

  const label = leadLabel(lead);
  const mode = await getPoolMode(ctx.organizationId);
  if (mode === "auto") {
    const taken = await awardLead(ctx, { id: request.id, leadId, requesterMembershipId: ctx.membershipId }, label, "auto");
    if (!taken) {
      await decidePoolRequest(ctx.organizationId, request.id, { status: "SUPERSEDED", decisionReason: "The lead was taken by someone else." });
      throw new ValidationError("Someone else took this lead a moment ago.", [{ path: "leadId", message: "Already taken.", code: "LEAD_ALREADY_OWNED" }]);
    }
    return { request: (await getPoolRequest(ctx.organizationId, request.id))!, mode, taken: true };
  }

  const name = await requesterName(ctx.organizationId, ctx.membershipId);
  for (const membershipId of await managementRecipients(ctx.organizationId, ctx.membershipId)) {
    await notifyLeadPool(ctx.organizationId, membershipId, {
      requestId: request.id,
      leadId,
      title: `${name} asks to take a lead: ${label}`,
      body: note ? `"${note}"` : "Open the lead pool to approve or decline.",
    });
  }
  return { request, mode, taken: false };
}

export async function listRequests(ctx: AuthContext, filter: { status?: string } = {}, request: PageRequest = {}) {
  const manager = hasPermission(ctx, "leads.assign");
  if (!manager && !hasPermission(ctx, "leads.view.shared")) requirePermission(ctx, "leads.assign");
  const paging = resolvePaging(request);
  const status = filter.status as LeadPoolRequestStatus | undefined;
  if (status && !["PENDING", "APPROVED", "DECLINED", "CANCELLED", "SUPERSEDED"].includes(status)) {
    throw new ValidationError("Unknown status.", [{ path: "status", message: "Use PENDING, APPROVED, DECLINED, CANCELLED or SUPERSEDED." }]);
  }
  const { items, total } = await listPoolRequests(
    ctx.organizationId,
    { status, requesterMembershipId: manager ? undefined : ctx.membershipId },
    paging,
  );
  return buildPage(items, total, paging);
}

/** Management answers a request. Approve gives the lead to the requester if it is still unowned; decline keeps it in the pool and needs a reason. */
export async function decideRequest(ctx: AuthContext, requestId: string, input: { decision: "APPROVE" | "DECLINE"; reason?: string | null }) {
  requirePermission(ctx, "leads.assign");
  const request = await getPoolRequest(ctx.organizationId, requestId);
  if (!request) throw new NotFoundError("LeadPoolRequest", requestId);
  if (request.status !== "PENDING") {
    throw new ValidationError(`This request was already answered (${request.status.toLowerCase()}).`, [{ path: "status", message: "Not pending." }]);
  }
  const label = leadLabel(request.lead);

  if (input.decision === "DECLINE") {
    const reason = cleanArchiveReason(input.reason);
    if (!reason) throw new ValidationError("Give a reason for declining.", [{ path: "reason", message: "A reason is required." }]);
    const done = await decidePoolRequest(ctx.organizationId, requestId, { status: "DECLINED", decisionReason: reason, decidedByMembershipId: ctx.membershipId });
    if (!done) throw new ValidationError("This request was just answered by someone else.");
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "lead_pool.declined",
      entityType: "Lead",
      entityId: request.leadId,
      metadata: { requestId, reason, requester: request.requesterMembershipId },
    });
    await notifyLeadPool(ctx.organizationId, request.requesterMembershipId, {
      requestId,
      leadId: request.leadId,
      title: `Request declined: ${label}`,
      body: `The lead stays in the pool. Reason: ${reason}`,
    });
    return getPoolRequest(ctx.organizationId, requestId);
  }

  // Only someone who can actually work leads may be given one.
  await assertEligibleLeadOwner(ctx.organizationId, request.requesterMembershipId);
  const won = await awardLead(ctx, request, label, "approved");
  if (!won) {
    await decidePoolRequest(ctx.organizationId, requestId, { status: "SUPERSEDED", decisionReason: "The lead already has an owner." });
    throw new ValidationError("This lead already has an owner, so the request cannot be approved.", [{ path: "leadId", message: "Already owned.", code: "LEAD_ALREADY_OWNED" }]);
  }
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "lead_pool.approved",
    entityType: "Lead",
    entityId: request.leadId,
    metadata: { requestId, requester: request.requesterMembershipId },
  });
  return getPoolRequest(ctx.organizationId, requestId);
}

export async function cancelRequest(ctx: AuthContext, requestId: string) {
  const request = await getPoolRequest(ctx.organizationId, requestId);
  if (!request || request.requesterMembershipId !== ctx.membershipId) throw new NotFoundError("LeadPoolRequest", requestId);
  const done = await decidePoolRequest(ctx.organizationId, requestId, { status: "CANCELLED", decidedByMembershipId: ctx.membershipId });
  if (!done) throw new ValidationError("Only a pending request can be cancelled.");
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "lead_pool.cancelled",
    entityType: "Lead",
    entityId: request.leadId,
    metadata: { requestId },
  });
  return getPoolRequest(ctx.organizationId, requestId);
}
