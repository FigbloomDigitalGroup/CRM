import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError } from "../auth/errors";
import { getCompany } from "./companyService";
import {
  createCompanyServiceLink as createCompanyServiceLinkRecord,
  getCompanyServiceLinkById,
  listCompanyServiceLinks as listCompanyServiceLinksRecord,
  updateCompanyServiceLink as updateCompanyServiceLinkRecord,
  type CreateCompanyServiceLinkInput,
  type UpdateCompanyServiceLinkInput,
} from "../repositories/companyServiceLinks";

export type CreateCompanyServiceLinkServiceInput = Omit<
  CreateCompanyServiceLinkInput,
  "organizationId" | "startDate" | "endDate"
> & { startDate?: string; endDate?: string };

export type UpdateCompanyServiceServiceInput = Omit<
  UpdateCompanyServiceLinkInput,
  "startDate" | "endDate"
> & { startDate?: string | null; endDate?: string | null };

/**
 * Tracks which services (FigBloom's own catalog, not a permission) a
 * Company has/had (FIG-598) -- gated by its own `company_services.*`
 * permission pair rather than overloading `companies.edit`, since
 * Delivery/Finance should plausibly see this without company-edit rights.
 * Still verifies the company itself is visible to the caller first
 * (`getCompany` already enforces `companies.view`/tenant scoping), so this
 * can never be used to probe a company's existence past that check.
 */
export async function addCompanyService(
  ctx: AuthContext,
  input: CreateCompanyServiceLinkServiceInput,
) {
  await getCompany(ctx, input.companyId);
  requirePermission(ctx, "company_services.manage");
  return createCompanyServiceLinkRecord({
    ...input,
    organizationId: ctx.organizationId,
    startDate: input.startDate ? new Date(input.startDate) : undefined,
    endDate: input.endDate ? new Date(input.endDate) : undefined,
  });
}

export async function listCompanyServices(ctx: AuthContext, companyId: string) {
  await getCompany(ctx, companyId);
  requirePermission(ctx, "company_services.view");
  return listCompanyServiceLinksRecord(ctx.organizationId, companyId);
}

export async function updateCompanyService(
  ctx: AuthContext,
  companyServiceId: string,
  input: UpdateCompanyServiceServiceInput,
) {
  requirePermission(ctx, "company_services.manage");
  const existing = await getCompanyServiceLinkById(ctx.organizationId, companyServiceId);
  if (!existing) {
    throw new NotFoundError("CompanyService", companyServiceId);
  }
  // Re-verifies the parent company is still visible to this caller, not
  // just that the row exists in this organization -- same belt-and-
  // suspenders as every other linked-record check in this codebase.
  await getCompany(ctx, existing.companyId);
  return updateCompanyServiceLinkRecord(ctx.organizationId, companyServiceId, {
    status: input.status,
    notes: input.notes,
    startDate:
      input.startDate === undefined ? undefined : input.startDate ? new Date(input.startDate) : null,
    endDate:
      input.endDate === undefined ? undefined : input.endDate ? new Date(input.endDate) : null,
  });
}
