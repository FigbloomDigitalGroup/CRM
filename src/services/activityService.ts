import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { adminDb } from "../db/adminClient";
import {
  createActivity as createActivityRecord,
  countActivities as countActivitiesRecord,
  listActivities as listActivitiesRecord,
  countActivitiesForTimeline as countActivitiesForTimelineRecord,
  listActivitiesForTimeline as listActivitiesForTimelineRecord,
  type CreateActivityInput,
} from "../repositories/activities";
import { getCompany } from "./companyService";
import { getContact } from "./contactService";
import { assertCanAccessLinkedRecords, type LinkedRecordIds } from "./recordAccess";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";

export type CreateActivityServiceInput = Omit<
  CreateActivityInput,
  "organizationId" | "authorMembershipId"
>;

export async function createActivity(
  ctx: AuthContext,
  input: CreateActivityServiceInput,
) {
  await assertCanAccessLinkedRecords(ctx, input, { requireAtLeastOne: true });
  requirePermission(ctx, "activities.create");

  return createActivityRecord({
    ...input,
    organizationId: ctx.organizationId,
    authorMembershipId: ctx.membershipId,
  });
}

async function listActivitiesFor(ctx: AuthContext, ids: LinkedRecordIds) {
  await assertCanAccessLinkedRecords(ctx, ids);
  requirePermission(ctx, "activities.view");
  return listActivitiesRecord(ctx.organizationId, ids);
}

export function listActivitiesForLead(ctx: AuthContext, leadId: string) {
  return listActivitiesFor(ctx, { leadId });
}

export function listActivitiesForDeal(ctx: AuthContext, dealId: string) {
  return listActivitiesFor(ctx, { dealId });
}

/** One page of a lead's or deal's activity log, oldest first, plus the total (FIG-789). */
export async function listActivitiesPage(
  ctx: AuthContext,
  ids: LinkedRecordIds,
  request: PageRequest = {},
) {
  await assertCanAccessLinkedRecords(ctx, ids);
  requirePermission(ctx, "activities.view");
  const paging = resolvePaging(request);
  const [items, total] = await Promise.all([
    listActivitiesRecord(ctx.organizationId, {
      ...ids,
      take: paging.take,
      skip: paging.skip,
    }),
    countActivitiesRecord(ctx.organizationId, ids),
  ]);
  return buildPage(items, total, paging);
}

/**
 * Which Lead/Deal ids under a given Company/Contact the caller is actually
 * allowed to see -- own vs. all, same split `leadService.listLeads`/
 * `dealService.listDeals` already enforce. Without this, a rep who can
 * only view their own leads would see a colleague's lead's activity log
 * leak into the Company timeline, something the Lead's own detail page
 * would 403 them for directly.
 */
async function visibleLeadAndDealIds(
  ctx: AuthContext,
  scope: { companyId: string } | { contactId: string },
) {
  const leadWhere =
    "companyId" in scope
      ? { organizationId: ctx.organizationId, companyId: scope.companyId }
      : { organizationId: ctx.organizationId, contactId: scope.contactId };
  const dealWhere =
    "companyId" in scope
      ? { organizationId: ctx.organizationId, companyId: scope.companyId }
      : { organizationId: ctx.organizationId, primaryContactId: scope.contactId };

  const [leads, deals] = await Promise.all([
    adminDb.lead.findMany({ where: leadWhere, select: { id: true, ownerMembershipId: true } }),
    adminDb.deal.findMany({ where: dealWhere, select: { id: true, ownerMembershipId: true } }),
  ]);

  const leadIds = hasPermission(ctx, "leads.view.all")
    ? leads.map((l) => l.id)
    : hasPermission(ctx, "leads.view.own")
      ? leads.filter((l) => l.ownerMembershipId === ctx.membershipId).map((l) => l.id)
      : [];

  const dealIds = hasPermission(ctx, "deals.view.all")
    ? deals.map((d) => d.id)
    : hasPermission(ctx, "deals.view.own")
      ? deals.filter((d) => d.ownerMembershipId === ctx.membershipId).map((d) => d.id)
      : [];

  return { leadIds, dealIds };
}

/** "Activities across their leads and deals" (FIG-600) -- see `listActivitiesForTimeline`'s doc comment. */
export async function listActivitiesForCompany(ctx: AuthContext, companyId: string) {
  await getCompany(ctx, companyId);
  requirePermission(ctx, "activities.view");
  const { leadIds, dealIds } = await visibleLeadAndDealIds(ctx, { companyId });
  return listActivitiesForTimelineRecord(ctx.organizationId, { companyId, leadIds, dealIds });
}

export async function listActivitiesForContact(ctx: AuthContext, contactId: string) {
  await getContact(ctx, contactId);
  requirePermission(ctx, "activities.view");
  const { leadIds, dealIds } = await visibleLeadAndDealIds(ctx, { contactId });
  return listActivitiesForTimelineRecord(ctx.organizationId, { contactId, leadIds, dealIds });
}

/**
 * One page of a Company's or Contact's cross-record timeline, plus the total
 * (FIG-789). Visibility is resolved exactly as in `listActivitiesForCompany`/
 * `listActivitiesForContact`, before any paging.
 */
export async function listTimelineActivitiesPage(
  ctx: AuthContext,
  scope: { companyId: string } | { contactId: string },
  request: PageRequest = {},
) {
  if ("companyId" in scope) await getCompany(ctx, scope.companyId);
  else await getContact(ctx, scope.contactId);
  requirePermission(ctx, "activities.view");
  const { leadIds, dealIds } = await visibleLeadAndDealIds(ctx, scope);
  const filter = { ...scope, leadIds, dealIds };
  const paging = resolvePaging(request);
  const [items, total] = await Promise.all([
    listActivitiesForTimelineRecord(ctx.organizationId, filter, {
      take: paging.take,
      skip: paging.skip,
    }),
    countActivitiesForTimelineRecord(ctx.organizationId, filter),
  ]);
  return buildPage(items, total, paging);
}
