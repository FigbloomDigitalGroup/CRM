import { withOrgContext } from "../db/orgScopedClient";

export interface CreateCompanyInput {
  organizationId: string;
  name: string;
  industry?: string;
  ownerMembershipId?: string;
  createdByMembershipId?: string;
}

/**
 * Every organization-scoped repository function follows the same shape:
 * accept `organizationId` explicitly, run inside `withOrgContext`, and
 * still filter/scope by it in the query even though RLS would also block a
 * mismatch — the two layers are deliberately redundant (FIG-437 section 16,
 * "Defense in Depth").
 */
export async function createCompany(input: CreateCompanyInput) {
  return withOrgContext(input.organizationId, (tx) =>
    tx.company.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        industry: input.industry,
        ownerMembershipId: input.ownerMembershipId,
        createdByMembershipId: input.createdByMembershipId,
      },
    }),
  );
}

export async function getCompanyById(
  organizationId: string,
  companyId: string,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.company.findFirst({
      where: { id: companyId, organizationId },
    }),
  );
}

export async function listCompanies(organizationId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.company.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    }),
  );
}
