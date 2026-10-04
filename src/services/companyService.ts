import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError } from "../auth/errors";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  createCompany as createCompanyRecord,
  findPossibleDuplicateCompanies,
  getCompanyById,
  listCompanies as listCompaniesRecords,
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
