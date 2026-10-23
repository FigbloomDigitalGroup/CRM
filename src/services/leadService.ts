import type { Prisma } from "@prisma/client";
import { assertWritable, cleanArchiveReason } from "../lib/archive";
import { findDuplicates } from "./duplicateService";
import { rescoreLeadQuietly } from "./scoreEngine";
import { auditCustomFieldChanges, prepareCustomFields } from "./customFieldService";
import { checkQualificationForSave, recordQualificationChange } from "./qualificationRules";
import type { AuthContext } from "../auth/context";
import {
  deny,
  hasPermission,
  requirePermission,
  requireOwnedRecordPermission,
} from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { assertRecordVisible } from "../auth/visibility";
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
  countLeads as countLeadsRecords,
  listLeads as listLeadsRecords,
  reassignLeadOwner,
  restoreLead as restoreLeadRecord,
  updateLead as updateLeadRecord,
  type CreateLeadInput,
  type ListLeadsFilters,
  type UpdateLeadInput,
} from "../repositories/leads";
import { diffAuditedFields } from "./auditDiff";
import {
  assertEligibleLeadOwner,
  canWorkDeals,
  canWorkLeads,
  loadActiveMemberWithPermissions,
} from "./ownerEligibility";
import { notifyLeadAssigned } from "./notificationService";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";

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

const LEAD_LOCKED_STATUS_KEYS = { converted: "CONVERTED", lost: "LOST" } as const;

/**
 * The people a lead can be handed to: active members whose role can view
 * and edit leads. Feeds every "Reassign" / "Owner" picker so the UI never
 * offers a target the server would reject.
 */
export async function listAssignableLeadOwners(ctx: AuthContext) {
  requirePermission(ctx, "leads.assign");
  const memberships = await adminDb.membership.findMany({
    where: { organizationId: ctx.organizationId, status: "ACTIVE" },
    include: {
      user: true,
      role: { include: { rolePermissions: { include: { permission: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  return memberships
    .filter((m) =>
      canWorkLeads(m.role.rolePermissions.map((rp) => rp.permission.key)),
    )
    .map((m) => ({
      membershipId: m.id,
      userName: m.user.name,
      roleName: m.role.name,
    }));
}

export async function createLead(
  ctx: AuthContext,
  input: CreateLeadServiceInput,
) {
  requirePermission(ctx, "leads.create");

  // Capturing a lead makes you its owner. Handing it to somebody else at
  // creation is a reassignment in all but name, so it needs the same
  // `leads.assign` permission `assignLead` does.
  let ownerMembershipId = ctx.membershipId;
  if (
    input.ownerMembershipId &&
    input.ownerMembershipId !== ctx.membershipId
  ) {
    requirePermission(ctx, "leads.assign");
    await assertEligibleLeadOwner(ctx.organizationId, input.ownerMembershipId);
    ownerMembershipId = input.ownerMembershipId;
  }

  const possibleDuplicates = await findPossibleDuplicateLeads(
    ctx.organizationId,
    {
      companyId: input.companyId,
    },
  );

  const found = await findDuplicates(ctx, {
    entity: "lead",
    companyId: input.companyId,
    contactId: input.contactId,
  });

  const createStatus = await adminDb.leadStatus.findFirst({
    where: { id: input.leadStatusId, organizationId: ctx.organizationId },
    select: { key: true },
  });
  const qualification = await checkQualificationForSave({
    organizationId: ctx.organizationId,
    serviceInterestId: input.serviceInterestId ?? null,
    existing: null,
    incoming: input.qualificationData,
    becomingQualified: createStatus?.key === "QUALIFIED",
  });
  const custom = await prepareCustomFields(ctx.organizationId, "LEAD", {
    incoming: input.customFields as Record<string, unknown> | undefined,
    mode: "create",
  });

  const lead = await createLeadRecord({
    ...input,
    qualificationData: qualification.values,
    customFields: custom?.values as Prisma.InputJsonValue | undefined,
    organizationId: ctx.organizationId,
    createdByMembershipId: ctx.membershipId,
    ownerMembershipId,
  });

  if (ownerMembershipId !== ctx.membershipId) {
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "lead.owner_reassigned",
      entityType: "Lead",
      entityId: lead.id,
      previousValue: { ownerMembershipId: ctx.membershipId },
      newValue: { ownerMembershipId },
    });
    await notifyLeadAssigned(ctx.organizationId, ownerMembershipId, {
      id: lead.id,
      label: "a new lead",
    });
  }

  await rescoreLeadQuietly(ctx.organizationId, lead.id);
  return { lead, possibleDuplicates, duplicates: found.candidates, hiddenDuplicates: found.hiddenCount };
}

async function loadOwnedLead(ctx: AuthContext, leadId: string) {
  const lead = await getLeadById(ctx.organizationId, leadId);
  if (!lead) {
    throw new NotFoundError("Lead", leadId);
  }
  // A lead the caller cannot see answers 404, same as one that does not exist.
  assertRecordVisible(ctx, "leads", "Lead", leadId, lead);
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
  return loadOwnedLead(ctx, leadId);
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

  assertWritable(ctx, "lead", lead, "making changes");

  // Ownership is deliberately not part of an edit -- it only ever changes
  // through `assignLead` (which needs `leads.assign`). Dropping the key
  // here means no caller can smuggle it in through a widened payload.
  const data = { ...input } as UpdateLeadInput & {
    ownerMembershipId?: unknown;
  };
  delete data.ownerMembershipId;
  let becomingQualified = false;

  if (data.leadStatusId !== undefined && data.leadStatusId !== lead.leadStatusId) {
    if (lead.convertedAt) {
      throw new ValidationError(
        "This lead has been converted to a deal, so its status can no longer change.",
      );
    }
    const nextStatus = await adminDb.leadStatus.findFirst({
      where: { id: data.leadStatusId, organizationId: ctx.organizationId },
    });
    if (!nextStatus) {
      throw new ValidationError("Unknown lead status.");
    }
    becomingQualified = nextStatus.key === "QUALIFIED";
    if (nextStatus.key === LEAD_LOCKED_STATUS_KEYS.converted) {
      throw new ValidationError(
        "A lead becomes Converted by converting it to a deal, not by picking the status.",
      );
    }
    if (nextStatus.key === LEAD_LOCKED_STATUS_KEYS.lost) {
      const reason =
        data.lostReasonId !== undefined ? data.lostReasonId : lead.lostReasonId;
      if (!reason) {
        throw new ValidationError("Choose a lost reason to mark a lead as Lost.");
      }
      data.lostReasonId = reason;
    } else {
      // Moving away from Lost (or to any other status) clears the reason so
      // it can't linger on a lead that is no longer lost.
      data.lostReasonId = null;
    }
  } else if (lead.convertedAt && data.lostReasonId !== undefined) {
    data.lostReasonId = lead.lostReasonId;
  }

  // Qualification answers are checked against the questions for the lead's service, and the
  // required ones must be there before it can become Qualified (FIG-1030, B2.01).
  const qualification = await checkQualificationForSave({
    organizationId: ctx.organizationId,
    serviceInterestId: data.serviceInterestId !== undefined ? data.serviceInterestId : lead.serviceInterestId,
    existing: lead.qualificationData,
    incoming: data.qualificationData,
    becomingQualified,
  });
  if (qualification.values !== undefined) data.qualificationData = qualification.values;
  const custom = await prepareCustomFields(ctx.organizationId, "LEAD", {
    existing: lead.customFields as Record<string, unknown>,
    incoming: input.customFields as Record<string, unknown> | undefined,
    mode: "update",
  });
  if (custom) data.customFields = custom.values as Prisma.InputJsonValue;

  const updated = await updateLeadRecord(ctx.organizationId, leadId, data);
  await recordQualificationChange(ctx, leadId, qualification.changes);
  if (custom) await auditCustomFieldChanges(ctx, "Lead", leadId, custom.changes);
  await rescoreLeadQuietly(ctx.organizationId, leadId);

  // Ownership is audited separately via assignLead -- this covers the
  // other important field changes updateLead never audited at all before
  // FIG-600 (status/source/temperature/lost-reason/re-parenting).
  const diff = diffAuditedFields(lead, data, AUDITED_LEAD_FIELDS);
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
function scopeLeadFilters(
  ctx: AuthContext,
  filters: ListLeadsFilters,
): ListLeadsFilters {
  if (hasPermission(ctx, "leads.view.all")) return filters;
  requirePermission(ctx, "leads.view.own");
  // Sales shared pool (departure.shared_pool): own leads plus unassigned ones.
  if (hasPermission(ctx, "leads.view.shared")) {
    // A forged owner filter is dropped, never trusted: the pool is the boundary.
    return { ...filters, ownerMembershipId: undefined, ownedByOrUnassigned: ctx.membershipId };
  }
  return { ...filters, ownerMembershipId: ctx.membershipId };
}

/**
 * Every matching lead, unpaged. Only for internal callers that genuinely
 * need the whole set or pass `take` themselves (search, the dashboard's
 * "latest" list); list screens and the API use `listLeadsPage` (FIG-789).
 */
export async function listLeads(
  ctx: AuthContext,
  filters: ListLeadsFilters = {},
) {
  return listLeadsRecords(ctx.organizationId, scopeLeadFilters(ctx, filters));
}

/** One page of leads plus the total, with the same own/all scoping as `listLeads` (FIG-789). */
export async function listLeadsPage(
  ctx: AuthContext,
  filters: ListLeadsFilters = {},
  request: PageRequest = {},
) {
  const scoped = scopeLeadFilters(ctx, filters);
  const paging = resolvePaging(request);
  const [items, total] = await Promise.all([
    listLeadsRecords(ctx.organizationId, {
      ...scoped,
      take: paging.take,
      skip: paging.skip,
    }),
    countLeadsRecords(ctx.organizationId, scoped),
  ]);
  return buildPage(items, total, paging);
}

/** How many leads this caller can see for `filters` -- a COUNT, never a row fetch (FIG-789). */
export async function countLeads(
  ctx: AuthContext,
  filters: ListLeadsFilters = {},
) {
  return countLeadsRecords(ctx.organizationId, scopeLeadFilters(ctx, filters));
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

  assertWritable(ctx, "lead", lead, "reassigning it");
  if (lead.convertedAt) {
    throw new ValidationError(
      "This lead has been converted -- the deal now owns the work.",
    );
  }

  const targetMembership = await assertEligibleLeadOwner(
    ctx.organizationId,
    newOwnerMembershipId,
  );

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

  assertWritable(ctx, "lead", lead, "converting it");
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

  // The deal inherits the lead's owner. Naming a different deal owner is a
  // reassignment, so it needs `leads.assign` just like assignLead does.
  let dealOwnerMembershipId = input.ownerMembershipId;
  if (
    dealOwnerMembershipId &&
    dealOwnerMembershipId !== (lead.ownerMembershipId ?? ctx.membershipId)
  ) {
    if (!hasPermission(ctx, "leads.assign")) {
      throw deny(ctx, "leads.assign (to choose a different deal owner)", ["leads.assign"]);
    }
    const member = await loadActiveMemberWithPermissions(
      ctx.organizationId,
      dealOwnerMembershipId,
    );
    if (!canWorkDeals(member.permissionKeys)) {
      throw new ValidationError(
        `A ${member.roleName} user cannot own deals -- pick someone whose role can view and edit deals.`,
      );
    }
  }
  if (!dealOwnerMembershipId && !lead.ownerMembershipId) {
    // An unassigned lead converted by Management: the converter owns the deal.
    dealOwnerMembershipId = ctx.membershipId;
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
      ownerMembershipId: dealOwnerMembershipId,
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
export async function archiveLead(ctx: AuthContext, leadId: string, input: { reason?: string | null } = {}) {
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

  const reason = cleanArchiveReason(input.reason);
  const archived = await archiveLeadRecord(ctx.organizationId, leadId, {
    membershipId: ctx.membershipId,
    reason,
  });

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "lead.archived",
    entityType: "Lead",
    entityId: leadId,
    metadata: reason ? { reason } : undefined,
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
