import type { AuthContext } from "../auth/context";
import {
  hasPermission,
  requirePermission,
  requireOwnedRecordPermission,
} from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import {
  convertLeadToDeal,
  LeadAlreadyConvertedError,
  LeadMissingCompanyError,
} from "../repositories/deals";
import { recordAuditEvent } from "../repositories/auditEvents";
import { notifyLeadAssigned } from "./notificationService";
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
 * NotFoundError means the lead doesn't exist in the caller's org at all
 * (wrong id, or a different tenant -- see tests/tenant-isolation.test.ts);
 * ForbiddenError means it exists but the caller's role/ownership doesn't
 * permit the action. Existence isn't treated as a secret between
 * colleagues in the same org.
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
 * Ownership boundary is enforced server-side: a caller with only
 * `leads.view.own` cannot see other people's leads no matter what
 * `filters.ownerMembershipId` they pass -- it's forced to their own
 * membership, never trusted from the client.
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
 * Reassignment is gated by `leads.assign` specifically, distinct from
 * edit -- Management has it, Sales does not.
 */
export async function assignLead(
  ctx: AuthContext,
  leadId: string,
  newOwnerMembershipId: string,
) {
  requirePermission(ctx, "leads.assign");
  const lead = await loadOwnedLead(ctx, leadId);

  // Prisma treats an `undefined` filter as "omit this condition" (id:
  // undefined would match *any* membership) and an `undefined` update
  // value as "leave unchanged" (the write below would silently no-op).
  // Both are correct Prisma semantics but wrong here, so validate the id
  // ourselves before either can apply.
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

  const reassigned = await reassignLeadOwner(
    ctx.organizationId,
    leadId,
    targetMembership.id,
  );

  // Ownership changes are auditable (FIG-441 AC) -- fire-and-forget-ish,
  // but awaited so a failure here surfaces rather than silently vanishing.
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "lead.owner_reassigned",
    entityType: "Lead",
    entityId: leadId,
    previousValue: { ownerMembershipId: lead.ownerMembershipId },
    newValue: { ownerMembershipId: targetMembership.id },
  });

  // Best-effort (FIG-597): a notification failure must never undo or fail
  // an otherwise-successful reassignment.
  await notifyLeadAssigned(ctx.organizationId, targetMembership.id, {
    id: leadId,
    label: lead.company?.name ?? lead.contact?.firstName ?? "a lead",
  });

  return reassigned;
}

export interface ConvertLeadServiceInput {
  companyId?: string;
  ownerMembershipId?: string;
  pipelineStageId?: string;
  serviceId?: string;
  value?: number | string;
  expectedCloseDate?: string;
  notes?: string;
}

/**
 * Conversion requires both ownership (via leads.edit.own/all, since
 * converting mutates the lead) and the dedicated `leads.convert`
 * permission, which is what actually gates creating a Deal from it.
 */
export async function convertLead(
  ctx: AuthContext,
  leadId: string,
  input: ConvertLeadServiceInput = {},
) {
  const lead = await loadOwnedLead(ctx, leadId);
  requireOwnedRecordPermission(
    ctx,
    "leads.edit.own",
    "leads.edit.all",
    lead.ownerMembershipId,
  );
  requirePermission(ctx, "leads.convert");

  if (lead.convertedAt) {
    throw new ValidationError(
      "This lead has already been converted to a deal.",
    );
  }
  if (!lead.companyId && !input.companyId) {
    throw new ValidationError(
      "A company is required to convert this lead -- attach an existing " +
        "company to the lead first, or pass companyId.",
    );
  }

  try {
    return await convertLeadToDeal({
      organizationId: ctx.organizationId,
      leadId,
      companyId: input.companyId,
      ownerMembershipId: input.ownerMembershipId,
      pipelineStageId: input.pipelineStageId,
      serviceId: input.serviceId,
      value: input.value,
      expectedCloseDate: input.expectedCloseDate
        ? new Date(input.expectedCloseDate)
        : undefined,
      notes: input.notes,
    });
  } catch (err) {
    if (
      err instanceof LeadAlreadyConvertedError ||
      err instanceof LeadMissingCompanyError
    ) {
      throw new ValidationError(err.message);
    }
    throw err;
  }
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
