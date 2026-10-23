import { Prisma } from "@prisma/client";
import { withOrgContext, type OrgScopedClient } from "../db/orgScopedClient";

/**
 * Candidate lookups for duplicate detection (FIG-1033, B2.04). Each one is a
 * cheap prefilter that returns a few ids; `src/services/duplicateService.ts`
 * scores them. The SQL expressions match the indexes created in
 * `20261023160000_duplicates_and_merge_records` and the normal forms in
 * `src/lib/matching.ts`.
 */

const LIMIT = 20;

type IdRow = { id: string };

async function ids(tx: OrgScopedClient, query: Prisma.Sql): Promise<string[]> {
  const rows = await tx.$queryRaw<IdRow[]>(query);
  return rows.map((r) => r.id);
}

/** Escapes LIKE wildcards in a user-derived token. */
function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface CandidateInput {
  phoneTail?: string | null;
  email?: string | null; // already normalised
  domain?: string | null;
  nameTokens?: string[];
  /** Records to leave out (the record being merged or edited). */
  excludeIds?: string[];
}

const NO_ID = "00000000-0000-0000-0000-000000000000";

/** Ids of active (not archived) contacts that share a phone tail, a normalised email, or a corporate email domain. */
export function contactCandidateIds(organizationId: string, input: CandidateInput) {
  return withOrgContext(organizationId, async (tx) => {
    const exclude = Prisma.join(input.excludeIds?.length ? input.excludeIds : [NO_ID]);
    const found = new Set<string>();
    if (input.phoneTail) {
      for (const id of await ids(
        tx,
        Prisma.sql`SELECT id FROM contacts WHERE organization_id = ${organizationId} AND archived_at IS NULL
          AND phone IS NOT NULL AND right(regexp_replace(phone, '\\D', '', 'g'), 9) = ${input.phoneTail}
          AND id NOT IN (${exclude}) LIMIT ${LIMIT}`,
      ))
        found.add(id);
    }
    if (input.email) {
      for (const id of await ids(
        tx,
        Prisma.sql`SELECT id FROM contacts WHERE organization_id = ${organizationId} AND archived_at IS NULL
          AND email IS NOT NULL AND lower(regexp_replace(email, '\\+[^@]*@', '@')) = ${input.email}
          AND id NOT IN (${exclude}) LIMIT ${LIMIT}`,
      ))
        found.add(id);
    }
    return [...found];
  });
}

/** Ids of active companies that share a phone tail, a normalised email, a domain (website or email), or a name token. */
export function companyCandidateIds(organizationId: string, input: CandidateInput) {
  return withOrgContext(organizationId, async (tx) => {
    const exclude = Prisma.join(input.excludeIds?.length ? input.excludeIds : [NO_ID]);
    const found = new Set<string>();
    if (input.phoneTail) {
      for (const id of await ids(
        tx,
        Prisma.sql`SELECT id FROM companies WHERE organization_id = ${organizationId} AND archived_at IS NULL
          AND phone IS NOT NULL AND right(regexp_replace(phone, '\\D', '', 'g'), 9) = ${input.phoneTail}
          AND id NOT IN (${exclude}) LIMIT ${LIMIT}`,
      ))
        found.add(id);
    }
    if (input.email) {
      for (const id of await ids(
        tx,
        Prisma.sql`SELECT id FROM companies WHERE organization_id = ${organizationId} AND archived_at IS NULL
          AND email IS NOT NULL AND lower(regexp_replace(email, '\\+[^@]*@', '@')) = ${input.email}
          AND id NOT IN (${exclude}) LIMIT ${LIMIT}`,
      ))
        found.add(id);
    }
    if (input.domain) {
      const host = likeEscape(input.domain);
      for (const id of await ids(
        tx,
        Prisma.sql`SELECT id FROM companies WHERE organization_id = ${organizationId} AND archived_at IS NULL
          AND id NOT IN (${exclude})
          AND (
            lower(regexp_replace(coalesce(website, ''), '^(?:[a-z][a-z0-9+.-]*://)?(?:www\\.)?([^/:?#]+).*$', '\\1', 'i')) = ${input.domain}
            OR lower(regexp_replace(coalesce(website, ''), '^(?:[a-z][a-z0-9+.-]*://)?(?:www\\.)?([^/:?#]+).*$', '\\1', 'i')) LIKE ${"%." + host}
            OR lower(split_part(coalesce(email, ''), '@', 2)) = ${input.domain}
            OR lower(split_part(coalesce(email, ''), '@', 2)) LIKE ${"%." + host}
          ) LIMIT ${LIMIT}`,
      ))
        found.add(id);
    }
    const tokens = (input.nameTokens ?? []).filter((t) => t.length >= 3).slice(0, 4);
    if (tokens.length > 0) {
      const patterns = tokens.map((t) => Prisma.sql`lower(name) LIKE ${"%" + likeEscape(t) + "%"}`);
      for (const id of await ids(
        tx,
        Prisma.sql`SELECT id FROM companies WHERE organization_id = ${organizationId} AND archived_at IS NULL
          AND id NOT IN (${exclude}) AND (${Prisma.join(patterns, " OR ")}) LIMIT 200`,
      ))
        found.add(id);
    }
    return [...found];
  });
}

/** Contacts with the same first (and, when given, last) name, ignoring case. */
export function contactIdsByName(organizationId: string, firstName: string, lastName: string | null, excludeIds: string[] = []) {
  return withOrgContext(organizationId, async (tx) => {
    const rows = await tx.contact.findMany({
      where: {
        organizationId,
        archivedAt: null,
        id: { notIn: excludeIds },
        firstName: { equals: firstName, mode: "insensitive" },
        ...(lastName ? { lastName: { equals: lastName, mode: "insensitive" } } : {}),
      },
      select: { id: true },
      take: LIMIT,
    });
    return rows.map((r) => r.id);
  });
}

export function getContactsByIds(organizationId: string, idList: string[]) {
  if (idList.length === 0) return Promise.resolve([]);
  return withOrgContext(organizationId, (tx) =>
    tx.contact.findMany({
      where: { organizationId, id: { in: idList }, archivedAt: null },
      include: { company: { select: { id: true, name: true } } },
    }),
  );
}

export function getCompaniesByIds(organizationId: string, idList: string[]) {
  if (idList.length === 0) return Promise.resolve([]);
  return withOrgContext(organizationId, (tx) =>
    tx.company.findMany({ where: { organizationId, id: { in: idList }, archivedAt: null } }),
  );
}

/** Open (not converted, not archived) leads for these companies and contacts, with the owner so the caller can scope them. */
export function openLeadsFor(organizationId: string, input: { companyIds: string[]; contactIds: string[] }) {
  const clauses: Prisma.LeadWhereInput[] = [];
  if (input.companyIds.length > 0) clauses.push({ companyId: { in: input.companyIds } });
  if (input.contactIds.length > 0) clauses.push({ contactId: { in: input.contactIds } });
  if (clauses.length === 0) return Promise.resolve([]);
  return withOrgContext(organizationId, (tx) =>
    tx.lead.findMany({
      where: { organizationId, convertedAt: null, archivedAt: null, OR: clauses },
      select: {
        id: true,
        ownerMembershipId: true,
        companyId: true,
        contactId: true,
        company: { select: { name: true } },
        contact: { select: { firstName: true, lastName: true } },
      },
      take: 50,
    }),
  );
}
