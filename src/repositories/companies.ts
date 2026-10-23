import { archivedWhere, type ArchiveMeta } from "../lib/archive";
import type { JsonClause } from "../lib/customFields";
import type { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";
import { TAG_LINKS_INCLUDE, tagFilter } from "./tags";

export interface CreateCompanyInput {
  customFields?: Prisma.InputJsonValue;
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
  customFields?: Prisma.InputJsonValue;
  name?: string;
  industry?: string | null;
  website?: string | null;
  location?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  lifecycleStateId?: string | null;
  ownerMembershipId?: string | null;
}

export interface ListCompaniesFilters {
  query?: string;
  /** Also match these ids: records whose phone matched the query in another format (FIG-1041). */
  matchIds?: string[];
  ownerMembershipId?: string;
  lifecycleStateId?: string;
  /** Archived companies are hidden from the default list (FIG-601) -- pass true to include them alongside active ones. */
  includeArchived?: boolean;
  /** The archived tab: only archived records (B2.16). */
  archivedOnly?: boolean;
  /** `customField[key]=value` filters (FIG-803), built by `buildCustomFieldWhere`. */
  customFieldClauses?: JsonClause[];
  /** Records carrying any of these tags (FIG-798). */
  tagIds?: string[];
  /** Caps the number of rows returned (e.g. global search's per-group limit, FIG-787) -- omit for the unbounded list views. */
  take?: number;
  /** Rows to skip before `take` -- set by the paged list functions (FIG-789), not by callers. */
  skip?: number;
}

/**
 * Just enough of the owning membership to show a name -- never the whole
 * user row (it carries the password hash) so list/detail results are safe
 * to serialize into API responses.
 */
const OWNER_SUMMARY = {
  select: { id: true, user: { select: { name: true } } },
} as const;

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
        customFields: input.customFields,
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
      include: {
        contacts: true,
        lifecycleState: true,
        owner: OWNER_SUMMARY,
        ...TAG_LINKS_INCLUDE,
      },
    }),
  );
}

/**
 * `query` matches (case-insensitive) against name, email, or phone. Company
 * names aren't unique (FIG-438 -- they may legitimately repeat), so this is
 * search, not exact lookup.
 */
/** Shared by the list and count queries so a page and its total can never disagree (FIG-789). */
/** Adds the custom field filters on top of the plain filters. */
function companiesWhere(...args: Parameters<typeof baseCompaniesWhere>): Prisma.CompanyWhereInput {
  const base = baseCompaniesWhere(...args);
  const clauses = args[1].customFieldClauses;
  if (!clauses || clauses.length === 0) return base;
  return { AND: [base, ...clauses.map((c) => ({ customFields: c as Prisma.JsonFilter<"Company"> }))] };
}

function baseCompaniesWhere(
  organizationId: string,
  filters: ListCompaniesFilters,
): Prisma.CompanyWhereInput {
  return {
    organizationId,
    ownerMembershipId: filters.ownerMembershipId,
    lifecycleStateId: filters.lifecycleStateId,
    ...archivedWhere(filters),
    ...tagFilter(filters.tagIds),
    ...(filters.query
      ? {
          OR: [
            { name: { contains: filters.query, mode: "insensitive" } },
            { email: { contains: filters.query, mode: "insensitive" } },
            { phone: { contains: filters.query, mode: "insensitive" } },
            ...(filters.matchIds?.length ? [{ id: { in: filters.matchIds } }] : []),
          ],
        }
      : {}),
  };
}

export async function listCompanies(
  organizationId: string,
  filters: ListCompaniesFilters = {},
) {
  return withOrgContext(organizationId, (tx) =>
    tx.company.findMany({
      where: companiesWhere(organizationId, filters),
      include: {
        lifecycleState: true,
        owner: OWNER_SUMMARY,
        _count: { select: { contacts: { where: { archivedAt: null } } } },
        ...TAG_LINKS_INCLUDE,
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: filters.take,
      skip: filters.skip,
    }),
  );
}

/** Rows matching `filters` across all pages (FIG-789) -- ignores `take`/`skip`. */
export async function countCompanies(
  organizationId: string,
  filters: ListCompaniesFilters = {},
) {
  return withOrgContext(organizationId, (tx) =>
    tx.company.count({ where: companiesWhere(organizationId, filters) }),
  );
}

/** Sets `archivedAt` (FIG-601) -- never a hard delete; see the model's doc comment. */
export async function archiveCompany(organizationId: string, companyId: string, meta: ArchiveMeta = {}) {
  return withOrgContext(organizationId, (tx) =>
    tx.company.update({
      where: { id: companyId, organizationId },
      data: {
        archivedAt: new Date(),
        archivedByMembershipId: meta.membershipId ?? null,
        archiveReason: meta.reason ?? null,
      },
    }),
  );
}

export async function restoreCompany(organizationId: string, companyId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.company.update({
      where: { id: companyId, organizationId },
      data: { archivedAt: null, archivedByMembershipId: null, archiveReason: null, mergedIntoId: null },
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
      where: { organizationId, archivedAt: null, OR: clauses },
      take: 5,
    }),
  );
}
