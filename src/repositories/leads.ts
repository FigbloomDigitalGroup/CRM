import { archivedWhere, type ArchiveMeta } from "../lib/archive";
import type { JsonClause } from "../lib/customFields";
import { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";
import { TAG_LINKS_INCLUDE, tagFilter } from "./tags";

export interface CreateLeadInput {
  customFields?: Prisma.InputJsonValue;
  organizationId: string;
  leadStatusId: string;
  companyId?: string;
  contactId?: string;
  leadSourceId?: string;
  temperature?: "HOT" | "WARM" | "COLD";
  serviceInterestId?: string;
  ownerMembershipId?: string;
  createdByMembershipId?: string;
  qualificationData?: Prisma.InputJsonValue;
}

export async function createLead(input: CreateLeadInput) {
  return withOrgContext(input.organizationId, (tx) =>
    tx.lead.create({
      data: {
        organizationId: input.organizationId,
        leadStatusId: input.leadStatusId,
        companyId: input.companyId,
        contactId: input.contactId,
        leadSourceId: input.leadSourceId,
        temperature: input.temperature,
        serviceInterestId: input.serviceInterestId,
        ownerMembershipId: input.ownerMembershipId,
        createdByMembershipId: input.createdByMembershipId,
        qualificationData: input.qualificationData,
        customFields: input.customFields,
      },
    }),
  );
}

/**
 * Lead -> Deal conversion lives in `deals.ts#convertLeadToDeal` (FIG-440) --
 * it creates a Deal, so that's its home even though it starts from a Lead id.
 */

export interface UpdateLeadInput {
  customFields?: Prisma.InputJsonValue;
  leadStatusId?: string;
  companyId?: string | null;
  contactId?: string | null;
  leadSourceId?: string | null;
  temperature?: "HOT" | "WARM" | "COLD";
  serviceInterestId?: string | null;
  qualificationData?: Prisma.InputJsonValue;
  lostReasonId?: string | null;
  nextFollowUpAt?: Date | null;
  notes?: string | null;
}

export async function updateLead(
  organizationId: string,
  leadId: string,
  input: UpdateLeadInput,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.lead.update({
      where: { id: leadId, organizationId },
      data: input,
    }),
  );
}

/**
 * Kept separate from a general edit because "leads.assign" is its own
 * permission (FIG-437), distinct from leads.edit.* -- lets the service
 * layer gate it independently.
 */
export async function reassignLeadOwner(
  organizationId: string,
  leadId: string,
  ownerMembershipId: string,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.lead.update({
      where: { id: leadId, organizationId },
      data: { ownerMembershipId },
    }),
  );
}

export async function getLeadById(organizationId: string, leadId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.lead.findFirst({
      where: { id: leadId, organizationId },
      include: {
        company: true,
        contact: true,
        leadStatus: true,
        leadSource: true,
        lostReason: true,
        ...TAG_LINKS_INCLUDE,
      },
    }),
  );
}

/**
 * Of the given lead ids, the ones that are still live *and* currently owned
 * by `membershipId` (not archived, not reassigned away). Backs the
 * notification feed's "is this assignment still true?" check so the bell and
 * the dashboard/Leads list can never disagree about what you own.
 */
export async function findActiveLeadIdsOwnedBy(
  organizationId: string,
  membershipId: string,
  leadIds: string[],
): Promise<Set<string>> {
  if (leadIds.length === 0) return new Set();
  const rows = await withOrgContext(organizationId, (tx) =>
    tx.lead.findMany({
      where: {
        organizationId,
        id: { in: leadIds },
        ownerMembershipId: membershipId,
        archivedAt: null,
      },
      select: { id: true },
    }),
  );
  return new Set(rows.map((r) => r.id));
}

export interface ListLeadsFilters {
  query?: string;
  /** Also match leads whose contact or company phone matched the query in another format (FIG-1041). */
  matchContactIds?: string[];
  matchCompanyIds?: string[];
  ownerMembershipId?: string;
  leadStatusId?: string;
  leadSourceId?: string;
  temperature?: "HOT" | "WARM" | "COLD";
  createdAfter?: Date;
  createdBefore?: Date;
  /**
   * Set by the service for a caller with `leads.view.own` plus the shared
   * pool (B1.03): only leads they own or leads nobody owns, ANDed with every
   * other filter.
   */
  ownedByOrUnassigned?: string;
  /** Archived leads are hidden from the default list (FIG-601) -- pass true to include them alongside active ones. */
  includeArchived?: boolean;
  /** The archived tab: only archived records (B2.16). */
  archivedOnly?: boolean;
  /** The shared pool (B2.02): leads with no owner, still open. */
  unassignedOnly?: boolean;
  /** `customField[key]=value` filters (FIG-803), built by `buildCustomFieldWhere`. */
  customFieldClauses?: JsonClause[];
  /** Records carrying any of these tags (FIG-798). */
  tagIds?: string[];
  /** Standard `sort` (B0.06); the default order is newest first. `id` always breaks ties. */
  sort?: { field: LeadSortField; direction: "asc" | "desc" };
  /** Caps the number of rows returned (e.g. global search's per-group limit, FIG-787) -- omit for the unbounded list views. */
  take?: number;
  /** Rows to skip before `take` -- set by the paged list functions (FIG-789), not by callers. */
  skip?: number;
}

export const LEAD_SORT_FIELDS = ["createdAt", "updatedAt", "temperature", "nextFollowUpAt"] as const;
export type LeadSortField = (typeof LEAD_SORT_FIELDS)[number];

/** Shared by the list and count queries so a page and its total can never disagree (FIG-789). */
/** Adds the custom field filters on top of the plain filters. */
function leadsWhere(...args: Parameters<typeof baseLeadsWhere>): Prisma.LeadWhereInput {
  const base = baseLeadsWhere(...args);
  const clauses = args[1].customFieldClauses;
  if (!clauses || clauses.length === 0) return base;
  return { AND: [base, ...clauses.map((c) => ({ customFields: c as Prisma.JsonFilter<"Lead"> }))] };
}

function baseLeadsWhere(
  organizationId: string,
  filters: ListLeadsFilters,
): Prisma.LeadWhereInput {
  return {
    organizationId,
    ownerMembershipId: filters.ownerMembershipId,
    leadStatusId: filters.leadStatusId,
    leadSourceId: filters.leadSourceId,
    temperature: filters.temperature,
    ...(filters.ownedByOrUnassigned
      ? {
          AND: [
            {
              OR: [
                { ownerMembershipId: filters.ownedByOrUnassigned },
                { ownerMembershipId: null },
              ],
            },
          ],
        }
      : {}),
    ...archivedWhere(filters),
    ...tagFilter(filters.tagIds),
    ...(filters.unassignedOnly ? { ownerMembershipId: null, convertedAt: null } : {}),
    ...(filters.createdAfter || filters.createdBefore
      ? {
          createdAt: {
            ...(filters.createdAfter ? { gte: filters.createdAfter } : {}),
            ...(filters.createdBefore ? { lt: filters.createdBefore } : {}),
          },
        }
      : {}),
    ...(filters.query
      ? {
          OR: [
            { notes: { contains: filters.query, mode: "insensitive" } },
            ...(filters.matchContactIds?.length ? [{ contactId: { in: filters.matchContactIds } }] : []),
            ...(filters.matchCompanyIds?.length ? [{ companyId: { in: filters.matchCompanyIds } }] : []),
            {
              company: {
                name: { contains: filters.query, mode: "insensitive" },
              },
            },
            {
              contact: {
                firstName: { contains: filters.query, mode: "insensitive" },
              },
            },
            {
              contact: {
                lastName: { contains: filters.query, mode: "insensitive" },
              },
            },
            {
              contact: {
                email: { contains: filters.query, mode: "insensitive" },
              },
            },
          ],
        }
      : {}),
  };
}

export async function listLeads(
  organizationId: string,
  filters: ListLeadsFilters = {},
) {
  return withOrgContext(organizationId, (tx) =>
    tx.lead.findMany({
      where: leadsWhere(organizationId, filters),
      include: {
        company: true,
        contact: true,
        leadStatus: true,
        leadSource: true,
        ...TAG_LINKS_INCLUDE,
      },
      orderBy: filters.sort
        ? [{ [filters.sort.field]: filters.sort.direction }, { id: "asc" }]
        : [{ createdAt: "desc" }, { id: "asc" }],
      take: filters.take,
      skip: filters.skip,
    }),
  );
}

/** Rows matching `filters` across all pages (FIG-789) -- ignores `take`/`skip`. */
export async function countLeads(
  organizationId: string,
  filters: ListLeadsFilters = {},
) {
  return withOrgContext(organizationId, (tx) =>
    tx.lead.count({ where: leadsWhere(organizationId, filters) }),
  );
}

/** Surfaces likely-duplicate leads by contact email/phone or company, for the UI/API caller to warn on before creating (FIG-438 section 9; not a hard block). */
export async function findPossibleDuplicateLeads(
  organizationId: string,
  candidate: {
    contactEmail?: string;
    contactPhone?: string;
    companyId?: string;
  },
) {
  const clauses: Prisma.LeadWhereInput[] = [];
  if (candidate.companyId) clauses.push({ companyId: candidate.companyId });
  if (candidate.contactEmail)
    clauses.push({ contact: { email: candidate.contactEmail } });
  if (candidate.contactPhone)
    clauses.push({ contact: { phone: candidate.contactPhone } });
  if (clauses.length === 0) return [];

  return withOrgContext(organizationId, (tx) =>
    tx.lead.findMany({
      where: { organizationId, convertedAt: null, archivedAt: null, OR: clauses },
      include: { company: true, contact: true },
      take: 5,
    }),
  );
}

/** Leads already converted to a deal that match this contact or company (FIG-1034: an import row for one is "already converted"). */
export async function findConvertedLeadMatches(
  organizationId: string,
  candidate: { contactEmail?: string; contactPhone?: string; companyId?: string },
) {
  const clauses: Prisma.LeadWhereInput[] = [];
  if (candidate.companyId) clauses.push({ companyId: candidate.companyId });
  if (candidate.contactEmail) clauses.push({ contact: { email: candidate.contactEmail } });
  if (candidate.contactPhone) clauses.push({ contact: { phone: candidate.contactPhone } });
  if (clauses.length === 0) return [];
  return withOrgContext(organizationId, (tx) =>
    tx.lead.findMany({
      where: { organizationId, convertedAt: { not: null }, OR: clauses },
      select: { id: true },
      take: 3,
    }),
  );
}

/** Sets `archivedAt` (FIG-601) -- never a hard delete; see the model's doc comment. */
export async function archiveLead(organizationId: string, leadId: string, meta: ArchiveMeta = {}) {
  return withOrgContext(organizationId, (tx) =>
    tx.lead.update({
      where: { id: leadId, organizationId },
      data: {
        archivedAt: new Date(),
        archivedByMembershipId: meta.membershipId ?? null,
        archiveReason: meta.reason ?? null,
      },
    }),
  );
}

export async function restoreLead(organizationId: string, leadId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.lead.update({
      where: { id: leadId, organizationId },
      data: { archivedAt: null, archivedByMembershipId: null, archiveReason: null },
    }),
  );
}

/**
 * Gives an unowned lead to someone, in one conditional statement: it matches
 * only while the lead still has no owner, so of two people taking the same lead
 * at once exactly one gets it. Returns whether this call got it.
 */
export async function takeUnassignedLead(organizationId: string, leadId: string, membershipId: string): Promise<boolean> {
  return withOrgContext(organizationId, async (tx) => {
    const { count } = await tx.lead.updateMany({
      where: { id: leadId, organizationId, ownerMembershipId: null, convertedAt: null, archivedAt: null },
      data: { ownerMembershipId: membershipId },
    });
    return count === 1;
  });
}
