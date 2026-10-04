import type { AuthContext } from "../auth/context";
import {
  hasPermission,
  requirePermission,
  requireOwnedRecordPermission,
} from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  convertLeadToDeal,
  LeadAlreadyConvertedError,
  LeadMissingCompanyError,
  type NewCompanyDuringConversion,
  type NewContactDuringConversion,
} from "../repositories/deals";
import {
  archiveLead as archiveLeadRecord,
  createLead as createLeadRecord,
  findPossibleDuplicateLeads,
  getLeadById,
  listLeads as listLeadsRecords,
  reassignLeadOwner,
  restoreLead as restoreLeadRecord,
  updateLead as updateLeadRecord,
  type CreateLeadInput,
  type ListLeadsFilters,
  type UpdateLeadInput,
} from "../repositories/leads";
import { diffAuditedFields } from "./auditDiff";
import { notifyLeadAssigned } from "./notificationService";

/** Beyond ownership (audited separately via `assignLead`): qualification/status changes (FIG-600 AC). */
const AUDITED_LEAD_FIELDS = [
  "leadStatusId",
  "leadSourceId",
  "temperature",
  "lostReasonId",
  "companyId",
  "contactId",
] as const;

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

  const updated = await updateLeadRecord(ctx.organizationId, leadId, input);

  // Ownership is audited separately via assignLead -- this covers the
  // other important field changes updateLead never audited at all before
  // FIG-600 (status/source/temperature/lost-reason/re-parenting).
  const diff = diffAuditedFields(lead, input, AUDITED_LEAD_FIELDS);
  if (diff) {
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "lead.updated",
      entityType: "Lead",
      entityId: leadId,
      previousValue: diff.previousValue,
      newValue: diff.newValue,
    });
  }

  return updated;
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
  /** Inline-create a company instead (FIG-601) -- only used when the lead has no companyId and none was supplied above. */
  newCompany?: NewCompanyDuringConversion;
  /** Inline-create a contact instead (FIG-601) -- only used when the lead has no contactId. */
  newContact?: NewContactDuringConversion;
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
 * Inline-creating a company/contact during conversion (FIG-601) is
 * additionally gated by `companies.create`/`contacts.create` -- the same
 * authority `companyService.createCompany`/`contactService.createContact`
 * already require, so conversion can't become a backdoor around them.
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
  if (!lead.companyId && !input.companyId && !input.newCompany) {
    throw new ValidationError(
      "A company is required to convert this lead -- attach an existing " +
        "company to the lead first, pass companyId, or pass newCompany to " +
        "create one inline.",
    );
  }
  if (input.newCompany) {
    requirePermission(ctx, "companies.create");
    if (!input.newCompany.name?.trim()) {
      throw new ValidationError("newCompany.name is required.");
    }
  }
  if (input.newContact) {
    requirePermission(ctx, "contacts.create");
    if (!input.newContact.firstName?.trim()) {
      throw new ValidationError("newContact.firstName is required.");
    }
  }

  try {
    return await convertLeadToDeal({
      organizationId: ctx.organizationId,
      leadId,
      companyId: input.companyId,
      newCompany: input.newCompany,
      newContact: input.newContact,
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

/** Soft-delete (FIG-601) -- own/all split, same tier as `leads.edit.own/.all`. */
export async function archiveLead(ctx: AuthContext, leadId: string) {
  const lead = await loadOwnedLead(ctx, leadId);
  requireOwnedRecordPermission(
    ctx,
    "leads.archive.own",
    "leads.archive.all",
    lead.ownerMembershipId,
  );
  if (lead.archivedAt) {
    throw new ValidationError("This lead is already archived.");
  }

  const archived = await archiveLeadRecord(ctx.organizationId, leadId);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "lead.archived",
    entityType: "Lead",
    entityId: leadId,
  });

  return archived;
}

export async function restoreLead(ctx: AuthContext, leadId: string) {
  const lead = await loadOwnedLead(ctx, leadId);
  requireOwnedRecordPermission(
    ctx,
    "leads.archive.own",
    "leads.archive.all",
    lead.ownerMembershipId,
  );
  if (!lead.archivedAt) {
    throw new ValidationError("This lead is not archived.");
  }

  const restored = await restoreLeadRecord(ctx.organizationId, leadId);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "lead.restored",
    entityType: "Lead",
    entityId: leadId,
  });

  return restored;
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
