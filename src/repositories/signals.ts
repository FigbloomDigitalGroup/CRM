import { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

/** Data access for `signal_snapshots` and the aggregates behind them (FIG-1043). */

export const SIGNALS_KEY = "dashboard";

export async function readSnapshot(organizationId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.signalSnapshot.findUnique({ where: { organizationId_key: { organizationId, key: SIGNALS_KEY } } }),
  );
}

export async function writeSnapshot(organizationId: string, value: Prisma.InputJsonValue, computedAt: Date) {
  return withOrgContext(organizationId, (tx) =>
    tx.signalSnapshot.upsert({
      where: { organizationId_key: { organizationId, key: SIGNALS_KEY } },
      create: { organizationId, key: SIGNALS_KEY, value, computedAt },
      update: { value, computedAt },
    }),
  );
}

/** Makes the cached values count as out of date, so the next read recomputes them. */
export async function markSnapshotStale(organizationId: string) {
  await withOrgContext(organizationId, (tx) =>
    tx.signalSnapshot.updateMany({ where: { organizationId, key: SIGNALS_KEY }, data: { computedAt: new Date(0) } }),
  );
}

/** One bucket of page usage: distinct people, distinct pages and total views in [from, to). */
export async function pageUsageBetween(organizationId: string, from: Date, to: Date) {
  return withOrgContext(organizationId, async (tx) => {
    const rows = await tx.$queryRaw<{ users: bigint; pages: bigint; views: bigint }[]>(
      Prisma.sql`SELECT COUNT(DISTINCT membership_id) AS users, COUNT(DISTINCT page) AS pages, COUNT(*) AS views
        FROM page_views WHERE organization_id = ${organizationId} AND viewed_at >= ${from} AND viewed_at < ${to}`,
    );
    const row = rows[0];
    return { activeUsers: Number(row?.users ?? 0), pagesUsed: Number(row?.pages ?? 0), views: Number(row?.views ?? 0) };
  });
}

export async function countActiveMembers(organizationId: string) {
  return withOrgContext(organizationId, (tx) => tx.membership.count({ where: { organizationId, status: "ACTIVE" } }));
}
