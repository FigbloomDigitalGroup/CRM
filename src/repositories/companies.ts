import type { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

export interface CreateCompanyInput {
  organizationId: string;
  name: string;
  industry?: string;
  website?: string;
  location?: string;
  phone?: string;
  email?: string;
  notes?: string;
  lifecycleStateId?: string;
  ownerMembershipId?: string;
  createdByMembershipId?: string;
}

export interface UpdateCompanyInput {
  name?: string;
  industry?: string;
  website?: string;
  location?: string;
  phone?: string;
  email?: string;
  notes?: string;
  lifecycleStateId?: string | null;
  ownerMembershipId?: string | null;
}

export interface ListCompaniesFilters {
  query?: string;
  ownerMembershipId?: string;
  lifecycleStateId?: string;
}

/**
 * Org-scoped functions take `organizationId` explicitly, run inside
 * `withOrgContext`, and still filter by it in the query -- redundant with
 * RLS, but defense in depth (FIG-437).
 */
export async function createCompany(input: CreateCompanyInput) {
  return withOrgContext(input.organizationId, (tx) =>
    tx.company.create({
      data: {
        organizationId: input.organizationId,
        name: input.name,
        industry: input.industry,
        website: input.website,
        location: input.location,
        phone: input.phone,
        email: input.email,
        notes: input.notes,
        lifecycleStateId: input.lifecycleStateId,
        ownerMembershipId: input.ownerMembershipId,
        createdByMembershipId: input.createdByMembershipId,
      },
    }),
  );
}

export async function updateCompany(
  organizationId: string,
  companyId: string,
  input: UpdateCompanyInput,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.company.update({
      where: { id: companyId, organizationId },
      data: input,
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
      include: { contacts: true, lifecycleState: true },
    }),
  );
}

/**
 * `query` matches (case-insensitive) against name, email, or phone. Company
 * names aren't unique (FIG-438 -- they may legitimately repeat), so this is
 * search, not exact lookup.
 */
export async function listCompanies(
  organizationId: string,
  filters: ListCompaniesFilters = {},
) {
  return withOrgContext(organizationId, (tx) =>
    tx.company.findMany({
      where: {
        organizationId,
        ownerMembershipId: filters.ownerMembershipId,
        lifecycleStateId: filters.lifecycleStateId,
        ...(filters.query
          ? {
              OR: [
                { name: { contains: filters.query, mode: "insensitive" } },
                { email: { contains: filters.query, mode: "insensitive" } },
                { phone: { contains: filters.query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
    }),
  );
}

/**
 * Detection, not prevention: surfaces likely-same companies by
 * name/email/phone so the caller can warn before creating, without
 * hard-blocking legitimate re-entries (FIG-438).
 */
export async function findPossibleDuplicateCompanies(
  organizationId: string,
  candidate: { name?: string; email?: string; phone?: string },
) {
  const clauses: Prisma.CompanyWhereInput[] = [];
  if (candidate.email) clauses.push({ email: candidate.email });
  if (candidate.phone) clauses.push({ phone: candidate.phone });
  if (candidate.name)
    clauses.push({ name: { equals: candidate.name, mode: "insensitive" } });
  if (clauses.length === 0) return [];

  return withOrgContext(organizationId, (tx) =>
    tx.company.findMany({
      where: { organizationId, OR: clauses },
      take: 5,
    }),
  );
}
