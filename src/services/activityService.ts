import { canView } from "../auth/permissions";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import {
  createActivity as createActivityRecord,
  listActivitiesWithCount,
  listActivities as listActivitiesRecord,
  countActivitiesForTimeline as countActivitiesForTimelineRecord,
  listActivitiesForTimeline as listActivitiesForTimelineRecord,
  type CreateActivityInput,
} from "../repositories/activities";
import { getCompany } from "./companyService";
import { getContact } from "./contactService";
import { touchDealActivity } from "../repositories/deals";
import { rescoreCompanyQuietly, rescoreLeadQuietly } from "./scoreEngine";
import { assertCanAccessLinkedRecords, type LinkedRecordIds } from "./recordAccess";
import { emitTeamActivity, leadLabelFor } from "./teamActivityNotifier";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import { TASK_TYPES, type TaskTypeValue } from "../repositories/tasks";
import { applyLeadFollowUp } from "./taskLinkService";
import { resolveAssignee } from "./taskService";

/**
 * "Log a call, then say what happens next" (P2-23). A logged activity is history and never makes an open task by itself; the next step
 * does, as the lead's follow-up, in the same transaction as the activity. Only for an activity logged on a lead.
 */
export interface NextStepInput {
  /** What the next step is: TASK (a plain follow-up), CALL, MEETING, EMAIL, QUOTE or VISIT. */
  type: TaskTypeValue;
  /** ISO date and time of the next step. */
  dueAt: string;
  title?: string;
  /** Default: the lead's owner. Only someone who may assign tasks can choose another person. */
  assigneeMembershipId?: string;
}

export type CreateActivityServiceInput = Omit<
  CreateActivityInput,
  "organizationId" | "authorMembershipId"
> & { nextStep?: NextStepInput };

export async function createActivity(
  ctx: AuthContext,
  rawInput: CreateActivityServiceInput,
) {
  const { nextStep, ...input } = rawInput;
  await assertCanAccessLinkedRecords(ctx, input, { requireAtLeastOne: true, requireWritable: true });
  requirePermission(ctx, "activities.create");

  let followUp: Parameters<typeof applyLeadFollowUp>[1] | null = null;
  if (nextStep) {
    if (!input.leadId) throw new ValidationError("A next step can only be added to something logged on a lead.", [{ path: "nextStep", message: "Log it on a lead." }]);
    requirePermission(ctx, "tasks.create");
    const due = new Date(nextStep.dueAt);
    if (Number.isNaN(due.getTime())) throw new ValidationError("The next step needs a valid date and time.", [{ path: "nextStep.dueAt", message: "Use a date and time." }]);
    if (!TASK_TYPES.includes(nextStep.type)) throw new ValidationError("The next step type is not valid.", [{ path: "nextStep.type", message: `Use one of ${TASK_TYPES.join(", ")}.` }]);
    const lead = await adminDb.lead.findFirst({ where: { id: input.leadId, organizationId: ctx.organizationId }, select: { ownerMembershipId: true } });
    const wanted = nextStep.assigneeMembershipId ?? lead?.ownerMembershipId ?? undefined;
    const assignee = await resolveAssignee(ctx, wanted).catch(() => ctx.membershipId);
    followUp = {
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      leadId: input.leadId,
      nextFollowUpAt: due,
      assigneeMembershipId: assignee,
      type: nextStep.type,
      title: nextStep.title?.trim() || undefined,
    };
  }

  const activity = await createActivityRecord(
    {
      ...input,
      organizationId: ctx.organizationId,
      authorMembershipId: ctx.membershipId,
    },
    followUp ? async (tx, created) => void (await applyLeadFollowUp(tx, { ...followUp!, sourceActivityId: created.id })) : undefined,
  );
  // A contact with a lead or a customer changes how it scores (B2.03).
  await rescoreLeadQuietly(ctx.organizationId, input.leadId);
  if (input.dealId) await touchDealActivity(ctx.organizationId, input.dealId);
  await rescoreCompanyQuietly(ctx.organizationId, input.companyId);
  // One team alert per note on a lead (FIG-1678). The same service serves the Conversation and the dashboard preview. The text is not sent.
  if (input.type === "NOTE" && input.leadId) {
    const lead = await adminDb.lead.findFirst({ where: { id: input.leadId, organizationId: ctx.organizationId }, select: { companyId: true, contactId: true } });
    await emitTeamActivity({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      eventKey: "NOTE_ADDED",
      entityType: "Lead",
      entityId: input.leadId,
      label: lead ? await leadLabelFor(ctx.organizationId, lead) : "a lead",
      route: `leads/${input.leadId}`,
    });
  }
  return activity;
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
  const { items, total } = await listActivitiesWithCount(ctx.organizationId, { ...ids, take: paging.take, skip: paging.skip });
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
    adminDb.deal.findMany({
      where: dealWhere,
      select: { id: true, ownerMembershipId: true, outcome: true },
    }),
  ]);

  // The scope resolver decides record by record: own, organisation, shared
  // pool and won-only all come out of the same place (B1.01).
  const leadIds = leads.filter((l) => canView(ctx, "leads", l)).map((l) => l.id);
  const dealIds = deals.filter((d) => canView(ctx, "deals", d)).map((d) => d.id);

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
