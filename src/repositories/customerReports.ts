import { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

/** Won deals per company: how many, the latest win, and their total value. */
export async function getWonDealsByCompany(organizationId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.deal.groupBy({
      by: ["companyId"],
      where: { organizationId, outcome: "WON", archivedAt: null },
      _count: { _all: true },
      _max: { wonAt: true },
      _sum: { value: true },
    }),
  );
}

/** Active service links that have not ended, per company. */
export async function getActiveServicesByCompany(
  organizationId: string,
  today: Date,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.companyService.groupBy({
      by: ["companyId"],
      where: {
        organizationId,
        status: "ACTIVE",
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      _count: { _all: true },
    }),
  );
}

export async function getCompanyNames(organizationId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const rows = await withOrgContext(organizationId, (tx) =>
    tx.company.findMany({
      where: { organizationId, id: { in: ids }, archivedAt: null },
      select: { id: true, name: true },
    }),
  );
  return new Map(rows.map((r) => [r.id, r.name]));
}

export interface SalespersonFilters {
  ownerMembershipId?: string;
  serviceId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

function wonWhere(organizationId: string, f: SalespersonFilters) {
  return {
    organizationId,
    outcome: "WON" as const,
    ownerMembershipId: f.ownerMembershipId,
    serviceId: f.serviceId,
    wonAt: {
      ...(f.dateFrom ? { gte: f.dateFrom } : {}),
      ...(f.dateTo ? { lt: f.dateTo } : {}),
    },
  };
}

/** Won count and value per owner in the window. */
export async function getWonBySalesperson(
  organizationId: string,
  filters: SalespersonFilters,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.deal.groupBy({
      by: ["ownerMembershipId"],
      where: wonWhere(organizationId, filters),
      _count: { _all: true },
      _sum: { value: true },
    }),
  );
}

/** Won count and value per owner per calendar month (UTC) of `wonAt`. */
export async function getWonBySalespersonByMonth(
  organizationId: string,
  filters: SalespersonFilters,
) {
  const rows = await withOrgContext(organizationId, (tx) =>
    tx.$queryRaw<
      { owner: string; month: Date; count: bigint; value: Prisma.Decimal | null }[]
    >(Prisma.sql`
      SELECT owner_membership_id AS owner,
             date_trunc('month', won_at AT TIME ZONE 'UTC') AS month,
             COUNT(*) AS count,
             SUM(value) AS value
      FROM deals
      WHERE organization_id = ${organizationId}
        AND outcome = 'WON'
        ${filters.ownerMembershipId ? Prisma.sql`AND owner_membership_id = ${filters.ownerMembershipId}` : Prisma.empty}
        ${filters.serviceId ? Prisma.sql`AND service_id = ${filters.serviceId}` : Prisma.empty}
        ${filters.dateFrom ? Prisma.sql`AND won_at >= ${filters.dateFrom}` : Prisma.empty}
        ${filters.dateTo ? Prisma.sql`AND won_at < ${filters.dateTo}` : Prisma.empty}
      GROUP BY 1, 2
      ORDER BY 2, 1
    `),
  );
  return rows.map((r) => ({
    ownerMembershipId: r.owner,
    month: r.month,
    count: Number(r.count),
    value: r.value,
  }));
}

/** Active services ending before `before` (including ones already past their end date). */
export async function listServicesEndingBefore(
  organizationId: string,
  before: Date,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.companyService.findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        endDate: { not: null, lt: before },
        company: { archivedAt: null },
      },
      include: {
        company: { select: { id: true, name: true } },
        service: { select: { id: true, name: true } },
      },
      orderBy: [{ endDate: "asc" }, { id: "asc" }],
    }),
  );
}

export async function getMembershipNames(organizationId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const rows = await withOrgContext(organizationId, (tx) =>
    tx.membership.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, user: { select: { name: true } } },
    }),
  );
  return new Map(rows.map((r) => [r.id, r.user.name]));
}
