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
  /** Archived companies are hidden from the default list (FIG-601) -- pass true to include them alongside active ones. */
  includeArchived?: boolean;
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
        ...(filters.includeArchived ? {} : { archivedAt: null }),
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

/** Sets `archivedAt` (FIG-601) -- never a hard delete; see the model's doc comment. */
export async function archiveCompany(organizationId: string, companyId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.company.update({
      where: { id: companyId, organizationId },
      data: { archivedAt: new Date() },
    }),
  );
}

export async function restoreCompany(organizationId: string, companyId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.company.update({
      where: { id: companyId, organizationId },
      data: { archivedAt: null, mergedIntoId: null },
    }),
  );
}

/**
 * Reassigns every Contact/Lead/Deal/Activity/Task/Communication/
 * CompanyService linked to `loserId` onto `winnerId`, then archives the
 * loser and records where it went (FIG-601). One transaction so a failure
 * partway through leaves nothing half-reassigned. The service layer
 * (`companyService.ts`) checks permissions and that both ids resolve to
 * real, distinct, not-already-archived companies before calling this.
 */
export async function mergeCompanies(
  organizationId: string,
  loserId: string,
  winnerId: string,
) {
  return withOrgContext(organizationId, async (tx) => {
    await tx.contact.updateMany({
      where: { organizationId, companyId: loserId },
      data: { companyId: winnerId },
    });
    await tx.lead.updateMany({
      where: { organizationId, companyId: loserId },
      data: { companyId: winnerId },
    });
    await tx.deal.updateMany({
      where: { organizationId, companyId: loserId },
      data: { companyId: winnerId },
    });
    await tx.activity.updateMany({
      where: { organizationId, companyId: loserId },
      data: { companyId: winnerId },
    });
    await tx.task.updateMany({
      where: { organizationId, companyId: loserId },
      data: { companyId: winnerId },
    });
    await tx.communication.updateMany({
      where: { organizationId, companyId: loserId },
      data: { companyId: winnerId },
    });
    await tx.companyService.updateMany({
      where: { organizationId, companyId: loserId },
      data: { companyId: winnerId },
    });

    return tx.company.update({
      where: { id: loserId, organizationId },
      data: { archivedAt: new Date(), mergedIntoId: winnerId },
    });
  });
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
      where: { organizationId, archivedAt: null, OR: clauses },
      take: 5,
    }),
  );
}
