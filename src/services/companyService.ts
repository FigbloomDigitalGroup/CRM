import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError } from "../auth/errors";
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

export type CreateCompanyServiceInput = Omit<
  CreateCompanyInput,
  "organizationId" | "createdByMembershipId"
>;

/**
 * Service layer = FIG-436's "Application/API Boundary" (section 10):
 * resolve organization + permission before touching data, apply business
 * rules (here: duplicate-detection warnings), then delegate to the
 * org-scoped repository. Route handlers should call these, never the
 * repositories directly.
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
