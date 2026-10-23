import { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

/**
 * Lookups behind global search (FIG-1041, B2.12). Phone numbers are compared
 * by their last nine digits, the same expression the
 * `contacts_phone_tail_idx` / `companies_phone_tail_idx` indexes hold, so
 * `+254 712 345 678`, `0712345678` and `712345678` find the same record.
 */

const LIMIT = 200;

export async function phoneMatchIds(organizationId: string, tail: string) {
  return withOrgContext(organizationId, async (tx) => {
    const [contacts, companies] = await Promise.all([
      tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM contacts WHERE organization_id = ${organizationId} AND phone IS NOT NULL
          AND right(regexp_replace(phone, '\\D', '', 'g'), 9) = ${tail} LIMIT ${LIMIT}`,
      ),
      tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT id FROM companies WHERE organization_id = ${organizationId} AND phone IS NOT NULL
          AND right(regexp_replace(phone, '\\D', '', 'g'), 9) = ${tail} LIMIT ${LIMIT}`,
      ),
    ]);
    return { contactIds: contacts.map((r) => r.id), companyIds: companies.map((r) => r.id) };
  });
}

const MAX_RECENTS = 10;

/** Remembers a search for this member; the same text (any case) just moves to the top. Only the newest few are kept. */
export async function rememberSearch(organizationId: string, membershipId: string, query: string) {
  await withOrgContext(organizationId, async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO search_recents (id, organization_id, membership_id, query, last_used_at)
        VALUES (gen_random_uuid()::text, ${organizationId}, ${membershipId}, ${query}, now())
        ON CONFLICT (organization_id, membership_id, lower(query)) DO UPDATE SET last_used_at = now(), query = EXCLUDED.query`,
    );
    await tx.$executeRaw(
      Prisma.sql`DELETE FROM search_recents WHERE organization_id = ${organizationId} AND membership_id = ${membershipId}
        AND id NOT IN (SELECT id FROM search_recents WHERE organization_id = ${organizationId} AND membership_id = ${membershipId}
          ORDER BY last_used_at DESC LIMIT ${MAX_RECENTS})`,
    );
  });
}

export async function listRecentSearches(organizationId: string, membershipId: string) {
  const rows = await withOrgContext(organizationId, (tx) =>
    tx.searchRecent.findMany({
      where: { organizationId, membershipId },
      orderBy: { lastUsedAt: "desc" },
      take: MAX_RECENTS,
    }),
  );
  return rows.map((r) => ({ query: r.query, lastUsedAt: r.lastUsedAt }));
}

export async function clearRecentSearches(organizationId: string, membershipId: string) {
  const { count } = await withOrgContext(organizationId, (tx) =>
    tx.searchRecent.deleteMany({ where: { organizationId, membershipId } }),
  );
  return { cleared: count };
}
