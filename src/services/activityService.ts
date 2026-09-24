import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import {
  createActivity as createActivityRecord,
  listActivities as listActivitiesRecord,
  type CreateActivityInput,
} from "../repositories/activities";
import { assertCanAccessLinkedRecords, type LinkedRecordIds } from "./recordAccess";

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

export function listActivitiesForCompany(ctx: AuthContext, companyId: string) {
  return listActivitiesFor(ctx, { companyId });
}

export function listActivitiesForContact(ctx: AuthContext, contactId: string) {
  return listActivitiesFor(ctx, { contactId });
}

export function listActivitiesForLead(ctx: AuthContext, leadId: string) {
  return listActivitiesFor(ctx, { leadId });
}

export function listActivitiesForDeal(ctx: AuthContext, dealId: string) {
  return listActivitiesFor(ctx, { dealId });
}
