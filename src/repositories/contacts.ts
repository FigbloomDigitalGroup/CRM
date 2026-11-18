import { archivedWhere, type ArchiveMeta } from "../lib/archive";
import type { JsonClause } from "../lib/customFields";
import type { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";
import { TAG_LINKS_INCLUDE, tagFilter } from "./tags";
import { companyIdsNamed } from "./searchMatch";

export interface CreateContactInput {
  customFields?: Prisma.InputJsonValue;
  organizationId: string;
  firstName: string;
  lastName?: string;
  companyId?: string;
  phone?: string;
  email?: string;
  jobTitle?: string;
  department?: string;
  notes?: string;
  ownerMembershipId?: string;
  createdByMembershipId?: string;
}

export interface UpdateContactInput {
  customFields?: Prisma.InputJsonValue;
  firstName?: string;
  lastName?: string | null;
  companyId?: string | null;
  phone?: string | null;
  email?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  notes?: string | null;
  ownerMembershipId?: string | null;
}

export interface ListContactsFilters {
  query?: string;
  /** Set by `listContacts` / `countContacts` once the companies the text names are looked up by id (searchMatch.ts); not for callers. */
  companyIdsNamed?: string[];
  /** Also match these ids: records whose phone matched the query in another format (FIG-1041). */
  matchIds?: string[];
  companyId?: string;
  ownerMembershipId?: string;
  /** Only contacts with no company (FIG-1056). */
  standalone?: boolean;
  /** Only contacts with no email address, or no phone number (FIG-1056). */
  missingEmail?: boolean;
  missingPhone?: boolean;
  /** Archived contacts are hidden from the default list (FIG-601) -- pass true to include them alongside active ones. */
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

/** See `OWNER_SUMMARY` in `companies.ts` -- a name, never the whole user row. */
const OWNER_SUMMARY = {
  select: { id: true, user: { select: { name: true } } },
} as const;

export async function createContact(input: CreateContactInput) {
  return withOrgContext(input.organizationId, (tx) =>
    tx.contact.create({
      data: {
        organizationId: input.organizationId,
        firstName: input.firstName,
        lastName: input.lastName,
        companyId: input.companyId,
        phone: input.phone,
        email: input.email,
        jobTitle: input.jobTitle,
        department: input.department,
        notes: input.notes,
        ownerMembershipId: input.ownerMembershipId,
        createdByMembershipId: input.createdByMembershipId,
        customFields: input.customFields,
      },
    }),
  );
}

export async function updateContact(
  organizationId: string,
  contactId: string,
  input: UpdateContactInput,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.contact.update({
      where: { id: contactId, organizationId },
      data: input,
    }),
  );
}

export async function getContactById(
  organizationId: string,
  contactId: string,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.contact.findFirst({
      where: { id: contactId, organizationId },
      include: { company: true, owner: OWNER_SUMMARY, ...TAG_LINKS_INCLUDE },
    }),
  );
}

/** Every contact belonging to `companyId` — supports "multiple contacts per company" (FIG-438 section 4). */
export async function listContactsByCompany(
  organizationId: string,
  companyId: string,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.contact.findMany({
      where: { organizationId, companyId },
      orderBy: { createdAt: "desc" },
    }),
  );
}

/** Shared by the list and count queries so a page and its total can never disagree (FIG-789). */
/** Adds the custom field filters on top of the plain filters. */
function contactsWhere(...args: Parameters<typeof baseContactsWhere>): Prisma.ContactWhereInput {
  const base = baseContactsWhere(...args);
  const filters = args[1];
  const and: Prisma.ContactWhereInput[] = (filters.customFieldClauses ?? []).map((c) => ({ customFields: c as Prisma.JsonFilter<"Contact"> }));
  if (filters.missingEmail) and.push({ OR: [{ email: null }, { email: "" }] });
  if (filters.missingPhone) and.push({ OR: [{ phone: null }, { phone: "" }] });
  if (and.length === 0) return base;
  return { AND: [base, ...and] };
}

function baseContactsWhere(
  organizationId: string,
  filters: ListContactsFilters,
): Prisma.ContactWhereInput {
  return {
    organizationId,
    companyId: filters.standalone ? null : filters.companyId,
    ownerMembershipId: filters.ownerMembershipId,
    ...archivedWhere(filters),
    ...tagFilter(filters.tagIds),
    ...(filters.query
      ? {
          OR: [
            { firstName: { contains: filters.query, mode: "insensitive" } },
            { lastName: { contains: filters.query, mode: "insensitive" } },
            { email: { contains: filters.query, mode: "insensitive" } },
            { phone: { contains: filters.query, mode: "insensitive" } },
            ...(filters.matchIds?.length ? [{ id: { in: filters.matchIds } }] : []),
            ...(filters.companyIdsNamed
              ? filters.companyIdsNamed.length ? [{ companyId: { in: filters.companyIdsNamed } }] : []
              : [{ company: { name: { contains: filters.query, mode: "insensitive" as const } } }]),
          ],
        }
      : {}),
  };
}

async function withCompanyMatch(tx: Prisma.TransactionClient, organizationId: string, filters: ListContactsFilters): Promise<ListContactsFilters> {
  if (!filters.query) return filters;
  const ids = await companyIdsNamed(tx, organizationId, filters.query);
  return ids ? { ...filters, companyIdsNamed: ids } : filters;
}

export async function listContacts(
  organizationId: string,
  filters: ListContactsFilters = {},
) {
  return withOrgContext(organizationId, async (tx) =>
    tx.contact.findMany({
      where: contactsWhere(organizationId, await withCompanyMatch(tx, organizationId, filters)),
      include: { company: true, owner: OWNER_SUMMARY, ...TAG_LINKS_INCLUDE },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: filters.take,
      skip: filters.skip,
    }),
  );
}

/** Rows matching `filters` across all pages (FIG-789) -- ignores `take`/`skip`. */
export async function countContacts(
  organizationId: string,
  filters: ListContactsFilters = {},
) {
  return withOrgContext(organizationId, async (tx) =>
    tx.contact.count({ where: contactsWhere(organizationId, await withCompanyMatch(tx, organizationId, filters)) }),
  );
}

/** Sets `archivedAt` (FIG-601) -- never a hard delete; see the model's doc comment. */
export async function archiveContact(organizationId: string, contactId: string, meta: ArchiveMeta = {}) {
  return withOrgContext(organizationId, (tx) =>
    tx.contact.update({
      where: { id: contactId, organizationId },
      data: {
        archivedAt: new Date(),
        archivedByMembershipId: meta.membershipId ?? null,
        archiveReason: meta.reason ?? null,
      },
    }),
  );
}

export async function restoreContact(organizationId: string, contactId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.contact.update({
      where: { id: contactId, organizationId },
      data: { archivedAt: null, archivedByMembershipId: null, archiveReason: null, mergedIntoId: null },
    }),
  );
}

/** Duplicate detection by email/phone (a shared work phone across contacts is legitimate — FIG-438 section 9 — so this surfaces candidates, it does not block). */
export async function findPossibleDuplicateContacts(
  organizationId: string,
  candidate: { email?: string; phone?: string },
) {
  const clauses: Prisma.ContactWhereInput[] = [];
  if (candidate.email) clauses.push({ email: candidate.email });
  if (candidate.phone) clauses.push({ phone: candidate.phone });
  if (clauses.length === 0) return [];

  return withOrgContext(organizationId, (tx) =>
    tx.contact.findMany({
      where: { organizationId, archivedAt: null, OR: clauses },
      take: 5,
    }),
  );
}

/** Exact email match, scoped to the organization -- used to auto-link an inbound email to an existing Contact (FIG-598). */
export async function findContactByEmail(organizationId: string, email: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.contact.findFirst({
      where: { organizationId, email: { equals: email, mode: "insensitive" } },
    }),
  );
}
