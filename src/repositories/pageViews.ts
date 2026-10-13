import { withOrgContext } from "../db/orgScopedClient";

export async function createPageView(
  organizationId: string,
  membershipId: string,
  page: string,
): Promise<void> {
  await withOrgContext(organizationId, (tx) =>
    tx.pageView.create({ data: { organizationId, membershipId, page } }),
  );
}

export interface PageUsageRow {
  page: string;
  visits: number;
  activeUsers: number;
}

export interface PageUsageSummary {
  since: Date;
  totalActiveUsers: number;
  pages: PageUsageRow[];
}

/**
 * Visits (row count) and distinct active users, both per page and
 * org-wide, since `since` (the caller decides the window -- the service
 * layer uses a trailing 7 days, matching "weekly active users"). Prisma's
 * `groupBy` can count rows per page but not distinct-membership counts per
 * group in one query, so the per-page active-user count is derived from a
 * `distinct: ["page", "membershipId"]` row fetch instead -- fine at this
 * table's volume (one row per page view, never per-field data to widen the
 * query).
 */
export async function getPageUsageSummary(
  organizationId: string,
  since: Date,
): Promise<PageUsageSummary> {
  return withOrgContext(organizationId, async (tx) => {
    const [visitsByPage, orgWideActiveUsers, activeUsersByPage] = await Promise.all([
      tx.pageView.groupBy({
        by: ["page"],
        where: { organizationId, viewedAt: { gte: since } },
        _count: { _all: true },
      }),
      tx.pageView.findMany({
        where: { organizationId, viewedAt: { gte: since } },
        select: { membershipId: true },
        distinct: ["membershipId"],
      }),
      tx.pageView.findMany({
        where: { organizationId, viewedAt: { gte: since } },
        select: { page: true, membershipId: true },
        distinct: ["page", "membershipId"],
      }),
    ]);

    const activeUserCountByPage = new Map<string, number>();
    for (const row of activeUsersByPage) {
      activeUserCountByPage.set(row.page, (activeUserCountByPage.get(row.page) ?? 0) + 1);
    }

    const pages = visitsByPage
      .map((row) => ({
        page: row.page,
        visits: row._count._all,
        activeUsers: activeUserCountByPage.get(row.page) ?? 0,
      }))
      .sort((a, b) => b.visits - a.visits);

    return { since, totalActiveUsers: orgWideActiveUsers.length, pages };
  });
}
