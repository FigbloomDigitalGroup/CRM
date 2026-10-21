import { canAssignAccountOwner, canWorkAccounts } from "../auth/accountAccess";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  archiveCompany as archiveCompanyRecord,
  createCompany as createCompanyRecord,
  findPossibleDuplicateCompanies,
  getCompanyById,
  listCompanies as listCompaniesRecords,
  mergeCompanies as mergeCompaniesRecord,
  restoreCompany as restoreCompanyRecord,
  updateCompany as updateCompanyRecord,
  type CreateCompanyInput,
  type ListCompaniesFilters,
  type UpdateCompanyInput,
} from "../repositories/companies";
import {
  cleanEmail,
  cleanNotes,
  cleanOptionalText,
  cleanRequiredText,
  omitNull,
} from "./accountValidation";
import { diffAuditedFields } from "./auditDiff";
import {
  assertEligibleAccountOwner,
  listAccountOwnerCandidates,
} from "./ownerEligibility";

/** Beyond ownership (audited separately, below): identity and lifecycle changes (FIG-600 AC). */
const AUDITED_COMPANY_FIELDS = ["name", "lifecycleStateId"] as const;

export type CreateCompanyServiceInput = Omit<
  CreateCompanyInput,
  "organizationId" | "createdByMembershipId"
>;

/**
 * Service layer (FIG-436): resolve organization + permission before
 * touching data, apply business rules (duplicate-detection warnings
 * here), then delegate to the org-scoped repository. Route handlers
 * should call these, never the repositories directly.
 *
 * Companies are shared org-wide -- anyone who can view them sees all of
 * them, anyone who can edit them can edit all of them. Only *reassigning*
 * the owner is restricted (`canAssignAccountOwner`: Management).
 */

async function assertLifecycleState(
  organizationId: string,
  lifecycleStateId: string | null | undefined,
) {
  if (!lifecycleStateId) return;
  const found = await adminDb.customerLifecycleState.findFirst({
    where: { id: lifecycleStateId, organizationId },
    select: { id: true },
  });
  if (!found) {
    throw new ValidationError("That lifecycle state does not exist in this organization.");
  }
}

/** People who can be handed a company -- feeds the owner pickers. Management only. */
export async function listAssignableCompanyOwners(ctx: AuthContext) {
  if (!canAssignAccountOwner(ctx, "companies")) {
    throw new ForbiddenError("companies.edit + membership.manage");
  }
  return listAccountOwnerCandidates(ctx.organizationId, "companies");
}

export async function createCompany(
  ctx: AuthContext,
  input: CreateCompanyServiceInput,
) {
  requirePermission(ctx, "companies.create");

  const name = cleanRequiredText(input.name, "Company name");
  if (!name) throw new ValidationError("Company name is required.");

  // The person who adds a company owns it -- provided they could work it
  // (a role that can create but not edit would only produce an owner who
  // cannot open their own record). Handing it to somebody else at creation
  // is a reassignment in all but name, so it needs the same rights.
  let ownerMembershipId: string | undefined = canWorkAccounts(
    ctx.permissionKeys,
    "companies",
  )
    ? ctx.membershipId
    : undefined;
  if (
    input.ownerMembershipId &&
    input.ownerMembershipId !== ctx.membershipId
  ) {
    if (!canAssignAccountOwner(ctx, "companies")) {
      throw new ForbiddenError("companies.edit + membership.manage (to choose a different owner)");
    }
    await assertEligibleAccountOwner(
      ctx.organizationId,
      input.ownerMembershipId,
      "companies",
    );
    ownerMembershipId = input.ownerMembershipId;
  }

  await assertLifecycleState(ctx.organizationId, input.lifecycleStateId);

  const clean = {
    name,
    industry: omitNull(cleanOptionalText(input.industry, "Industry")),
    website: omitNull(cleanOptionalText(input.website, "Website")),
    location: omitNull(cleanOptionalText(input.location, "Location")),
    phone: omitNull(cleanOptionalText(input.phone, "Phone", 40)),
    email: omitNull(cleanEmail(input.email)),
    notes: omitNull(cleanNotes(input.notes)),
  };

  const possibleDuplicates = await findPossibleDuplicateCompanies(
    ctx.organizationId,
    { name: clean.name, email: clean.email, phone: clean.phone },
  );

  const company = await createCompanyRecord({
    ...input,
    ...clean,
    organizationId: ctx.organizationId,
    createdByMembershipId: ctx.membershipId,
    ownerMembershipId,
  });

  if (ownerMembershipId && ownerMembershipId !== ctx.membershipId) {
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "company.owner_reassigned",
      entityType: "Company",
      entityId: company.id,
      previousValue: { ownerMembershipId: ctx.membershipId },
      newValue: { ownerMembershipId },
    });
  }

  return { company, possibleDuplicates };
}

export async function updateCompany(
  ctx: AuthContext,
  companyId: string,
  input: UpdateCompanyInput,
) {
  requirePermission(ctx, "companies.edit");

  const previous = await getCompanyById(ctx.organizationId, companyId);
  if (!previous) {
    throw new NotFoundError("Company", companyId);
  }
  if (previous.archivedAt) {
    throw new ValidationError(
      "This company is archived. Restore it before editing it.",
    );
  }

  const data: UpdateCompanyInput = {
    name: cleanRequiredText(input.name, "Company name"),
    industry: cleanOptionalText(input.industry, "Industry"),
    website: cleanOptionalText(input.website, "Website"),
    location: cleanOptionalText(input.location, "Location"),
    phone: cleanOptionalText(input.phone, "Phone", 40),
    email: cleanEmail(input.email),
    notes: cleanNotes(input.notes),
    lifecycleStateId: input.lifecycleStateId,
  };
  await assertLifecycleState(ctx.organizationId, input.lifecycleStateId);

  // Re-submitting the owner it already has is a no-op, not a reassignment.
  // Anything else is a handover: Management only, to someone who can work
  // companies, and never to "nobody" (an orphaned company helps no one).
  let ownerChanged = false;
  if (
    input.ownerMembershipId !== undefined &&
    input.ownerMembershipId !== previous.ownerMembershipId
  ) {
    if (!canAssignAccountOwner(ctx, "companies")) {
      throw new ForbiddenError("companies.edit + membership.manage (to reassign the owner)");
    }
    if (!input.ownerMembershipId) {
      throw new ValidationError(
        "A company needs an owner -- pick someone to hand it to.",
      );
    }
    await assertEligibleAccountOwner(
      ctx.organizationId,
      input.ownerMembershipId,
      "companies",
    );
    data.ownerMembershipId = input.ownerMembershipId;
    ownerChanged = true;
  }

  // Ownership changes are auditable (FIG-441 AC) regardless of which
  // other fields this same edit also touches.
  if (ownerChanged) {
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "company.owner_reassigned",
      entityType: "Company",
      entityId: companyId,
      previousValue: { ownerMembershipId: previous.ownerMembershipId },
      newValue: { ownerMembershipId: data.ownerMembershipId },
    });
  }

  // Broadened beyond ownership to other important field changes (FIG-600
  // AC) -- name and lifecycle-state transitions, bundled into one event.
  const diff = diffAuditedFields(previous, data, AUDITED_COMPANY_FIELDS);
  if (diff) {
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "company.updated",
      entityType: "Company",
      entityId: companyId,
      previousValue: diff.previousValue,
      newValue: diff.newValue,
    });
  }

  return updateCompanyRecord(ctx.organizationId, companyId, data);
}

export async function getCompany(ctx: AuthContext, companyId: string) {
  requirePermission(ctx, "companies.view");
  const company = await getCompanyById(ctx.organizationId, companyId);
  if (!company) {
    throw new NotFoundError("Company", companyId);
  }
  return company;
}

export async function listCompanies(
  ctx: AuthContext,
  filters: ListCompaniesFilters = {},
) {
  requirePermission(ctx, "companies.view");
  return listCompaniesRecords(ctx.organizationId, filters);
}

export async function checkDuplicateCompanies(
  ctx: AuthContext,
  candidate: { name?: string; email?: string; phone?: string },
) {
  requirePermission(ctx, "companies.create");
  return findPossibleDuplicateCompanies(ctx.organizationId, candidate);
}

/** Soft-delete (FIG-601) -- the row and everything linked to it stays intact, just hidden from default lists. */
export async function archiveCompany(ctx: AuthContext, companyId: string) {
  requirePermission(ctx, "companies.archive");
  const company = await getCompany(ctx, companyId);
  if (company.archivedAt) {
    throw new ValidationError("This company is already archived.");
  }

  const archived = await archiveCompanyRecord(ctx.organizationId, companyId);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "company.archived",
    entityType: "Company",
    entityId: companyId,
  });

  return archived;
}

/**
 * Restoring a company that was the *loser* of a merge only un-hides the
 * now-empty shell record -- its reassigned Contacts/Leads/Deals/etc. stay
 * with whatever it was merged into, this does not undo that (see
 * `mergeCompanies` below and IMPLEMENTATION_NOTES.md).
 */
export async function restoreCompany(ctx: AuthContext, companyId: string) {
  requirePermission(ctx, "companies.archive");
  const company = await getCompany(ctx, companyId);
  if (!company.archivedAt) {
    throw new ValidationError("This company is not archived.");
  }

  const restored = await restoreCompanyRecord(ctx.organizationId, companyId);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "company.restored",
    entityType: "Company",
    entityId: companyId,
  });

  return restored;
}

/**
 * Merges `loserId` into `winnerId` (FIG-601 AC: "preserving activities,
 * tasks, and history") -- every Contact/Lead/Deal/Activity/Task/
 * Communication/CompanyService currently pointing at the loser gets
 * re-pointed at the winner in one transaction, then the loser is archived
 * with `mergedIntoId` set. Nothing is deleted; the loser's own fields
 * (name/email/phone/...) are left as-is, just no longer the record new
 * work gets attached to.
 */
export async function mergeCompanies(
  ctx: AuthContext,
  loserId: string,
  winnerId: string,
) {
  requirePermission(ctx, "companies.merge");
  if (loserId === winnerId) {
    throw new ValidationError("Cannot merge a company into itself.");
  }

  const loser = await getCompany(ctx, loserId);
  const winner = await getCompany(ctx, winnerId);
  if (loser.archivedAt) {
    throw new ValidationError("This company is already archived -- it may already have been merged.");
  }
  if (winner.archivedAt) {
    throw new ValidationError("Cannot merge into an archived company.");
  }

  const merged = await mergeCompaniesRecord(ctx.organizationId, loserId, winnerId);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "company.merged",
    entityType: "Company",
    entityId: loserId,
    newValue: { mergedIntoId: winnerId },
    metadata: { winnerName: winner.name },
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "company.merged_from",
    entityType: "Company",
    entityId: winnerId,
    metadata: { loserId, loserName: loser.name },
  });

  return merged;
}
