import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
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
import { diffAuditedFields } from "./auditDiff";

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
 */
export async function createCompany(
  ctx: AuthContext,
  input: CreateCompanyServiceInput,
) {
  requirePermission(ctx, "companies.create");

  const possibleDuplicates = await findPossibleDuplicateCompanies(
    ctx.organizationId,
    {
      name: input.name,
      email: input.email,
      phone: input.phone,
    },
  );

  const company = await createCompanyRecord({
    ...input,
    organizationId: ctx.organizationId,
    createdByMembershipId: ctx.membershipId,
  });

  return { company, possibleDuplicates };
}

export async function updateCompany(
  ctx: AuthContext,
  companyId: string,
  input: UpdateCompanyInput,
) {
  requirePermission(ctx, "companies.edit");

  const previous = await getCompanyById(ctx.organizationId, companyId);

  // Ownership changes are auditable (FIG-441 AC) regardless of which
  // other fields this same edit also touches.
  if (previous && input.ownerMembershipId !== undefined) {
    if (previous.ownerMembershipId !== input.ownerMembershipId) {
      await recordAuditEvent({
        organizationId: ctx.organizationId,
        actorMembershipId: ctx.membershipId,
        action: "company.owner_reassigned",
        entityType: "Company",
        entityId: companyId,
        previousValue: { ownerMembershipId: previous.ownerMembershipId },
        newValue: { ownerMembershipId: input.ownerMembershipId },
      });
    }
  }

  // Broadened beyond ownership to other important field changes (FIG-600
  // AC) -- name and lifecycle-state transitions, bundled into one event.
  if (previous) {
    const diff = diffAuditedFields(previous, input, AUDITED_COMPANY_FIELDS);
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
  }

  return updateCompanyRecord(ctx.organizationId, companyId, input);
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
