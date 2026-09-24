import type { AuthContext } from "../auth/context";
import {
  hasPermission,
  requirePermission,
  requireOwnedRecordPermission,
} from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import {
  createLead as createLeadRecord,
  findPossibleDuplicateLeads,
  getLeadById,
  listLeads as listLeadsRecords,
  reassignLeadOwner,
  updateLead as updateLeadRecord,
  type CreateLeadInput,
  type ListLeadsFilters,
  type UpdateLeadInput,
} from "../repositories/leads";

export type CreateLeadServiceInput = Omit<
  CreateLeadInput,
  "organizationId" | "createdByMembershipId"
>;

export async function createLead(
  ctx: AuthContext,
  input: CreateLeadServiceInput,
) {
  requirePermission(ctx, "leads.create");

  const possibleDuplicates = await findPossibleDuplicateLeads(
    ctx.organizationId,
    {
      companyId: input.companyId,
    },
  );

  const lead = await createLeadRecord({
    ...input,
    organizationId: ctx.organizationId,
    createdByMembershipId: ctx.membershipId,
    // A rep capturing a lead is its owner by default unless someone with
    // leads.assign explicitly hands it to someone else on creation.
    ownerMembershipId: input.ownerMembershipId ?? ctx.membershipId,
  });

  return { lead, possibleDuplicates };
}

async function loadOwnedLead(ctx: AuthContext, leadId: string) {
  const lead = await getLeadById(ctx.organizationId, leadId);
  if (!lead) {
    throw new NotFoundError("Lead", leadId);
  }
  return lead;
}

/**
 * NotFoundError vs ForbiddenError is applied consistently across every
 * lead-service function: NotFoundError means the lead genuinely does not
 * exist in the caller's organization (wrong id, or it belongs to a
 * different tenant -- see tests/tenant-isolation.test.ts); ForbiddenError
 * means it exists but the caller's role/ownership does not permit the
 * requested action. Existence is not treated as a secret between
 * colleagues in the same organization.
 */
export async function getLead(ctx: AuthContext, leadId: string) {
  const lead = await loadOwnedLead(ctx, leadId);
  requireOwnedRecordPermission(
    ctx,
    "leads.view.own",
    "leads.view.all",
    lead.ownerMembershipId,
  );
  return lead;
}

export async function updateLead(
  ctx: AuthContext,
  leadId: string,
  input: UpdateLeadInput,
) {
  const lead = await loadOwnedLead(ctx, leadId);
  requireOwnedRecordPermission(
    ctx,
    "leads.edit.own",
    "leads.edit.all",
    lead.ownerMembershipId,
  );
  return updateLeadRecord(ctx.organizationId, leadId, input);
}

/**
 * Listing always applies an ownership boundary server-side: a caller with
 * only `leads.view.own` cannot see other people's leads no matter what
 * `filters.ownerMembershipId` they pass in -- it is forced to their own
 * membership, never trusted from the caller (FIG-437 section 10, "Frontend
 * hiding or disabling controls is not a security boundary" applies equally
 * to a client-supplied filter value).
 */
export async function listLeads(
  ctx: AuthContext,
  filters: ListLeadsFilters = {},
) {
  if (hasPermission(ctx, "leads.view.all")) {
    return listLeadsRecords(ctx.organizationId, filters);
  }
  requirePermission(ctx, "leads.view.own");
  return listLeadsRecords(ctx.organizationId, {
    ...filters,
    ownerMembershipId: ctx.membershipId,
  });
}

/**
 * Reassignment is gated by `leads.assign` specifically (distinct from
 * edit), per FIG-437 section 9 and the FIG-438 seed (Management has it,
 * Sales does not) -- this directly implements FIG-439's "Leads can be
 * assigned and reassigned according to permissions."
 */
export async function assignLead(
  ctx: AuthContext,
  leadId: string,
  newOwnerMembershipId: string,
) {
  requirePermission(ctx, "leads.assign");
  await loadOwnedLead(ctx, leadId);

  // A missing/empty id must fail loudly, not silently: Prisma treats an
  // `undefined` filter value as "omit this condition" (so `id: undefined`
  // would match *any* membership) and an `undefined` update value as "leave
  // this field unchanged" (so the write below would silently no-op instead
  // of erroring). Both behaviors are correct Prisma semantics for
  // intentionally-partial input, but wrong here -- the caller must always
  // supply a real target, so we validate it ourselves before either one
  // can apply. Never trust a client-supplied id without this check
  // (FIG-437 section 16, "Fail Closed").
  if (
    typeof newOwnerMembershipId !== "string" ||
    newOwnerMembershipId.length === 0
  ) {
    throw new ValidationError(
      "ownerMembershipId is required to assign a lead.",
    );
  }

  const targetMembership = await adminDb.membership.findFirst({
    where: {
      id: newOwnerMembershipId,
      organizationId: ctx.organizationId,
      status: "ACTIVE",
    },
  });
  if (!targetMembership) {
    throw new ValidationError(
      "The target owner must be an active member of this organization.",
    );
  }

  return reassignLeadOwner(ctx.organizationId, leadId, targetMembership.id);
}

export async function checkDuplicateLeads(
  ctx: AuthContext,
  candidate: {
    contactEmail?: string;
    contactPhone?: string;
    companyId?: string;
  },
) {
  requirePermission(ctx, "leads.create");
  return findPossibleDuplicateLeads(ctx.organizationId, candidate);
}
