import type { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

/** Filters for the organisation-wide audit reader (FIG-799, B4.09). Dates are inclusive UTC days. */
export interface AuditLogFilter {
  actorMembershipId?: string;
  entityType?: string;
  entityId?: string;
  /** An exact action, or a prefix when `actionPrefix` is set (for example "membership."). */
  action?: string;
  actionPrefix?: boolean;
  from?: Date;
  /** Exclusive upper bound: the day after the last day asked for. */
  to?: Date;
  /** Entity types this reader may not see at all. */
  excludeEntityTypes?: string[];
}

function whereFor(organizationId: string, filter: AuditLogFilter): Prisma.AuditEventWhereInput {
  const and: Prisma.AuditEventWhereInput[] = [{ organizationId }];
  if (filter.actorMembershipId) and.push({ actorMembershipId: filter.actorMembershipId });
  if (filter.entityType) and.push({ entityType: filter.entityType });
  if (filter.entityId) and.push({ entityId: filter.entityId });
  if (filter.action) and.push(filter.actionPrefix ? { action: { startsWith: filter.action } } : { action: filter.action });
  if (filter.from) and.push({ createdAt: { gte: filter.from } });
  if (filter.to) and.push({ createdAt: { lt: filter.to } });
  if (filter.excludeEntityTypes && filter.excludeEntityTypes.length > 0) {
    and.push({ entityType: { notIn: filter.excludeEntityTypes } });
  }
  return { AND: and };
}

export async function listAuditLog(
  organizationId: string,
  filter: AuditLogFilter,
  page: { skip: number; take: number },
) {
  const where = whereFor(organizationId, filter);
  return withOrgContext(organizationId, async (tx) => {
    const [rows, total] = await Promise.all([
      tx.auditEvent.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: page.skip,
        take: page.take,
      }),
      tx.auditEvent.count({ where }),
    ]);
    return { rows, total };
  });
}

/** What the filter dropdowns offer: the entity types and actions that exist, and who has acted. */
export async function auditFacets(organizationId: string, excludeEntityTypes: string[]) {
  return withOrgContext(organizationId, async (tx) => {
    const base: Prisma.AuditEventWhereInput = {
      organizationId,
      ...(excludeEntityTypes.length > 0 ? { entityType: { notIn: excludeEntityTypes } } : {}),
    };
    const [types, actions, actors] = await Promise.all([
      tx.auditEvent.groupBy({ by: ["entityType"], where: base, _count: { _all: true }, orderBy: { entityType: "asc" } }),
      tx.auditEvent.groupBy({ by: ["action"], where: base, _count: { _all: true }, orderBy: { action: "asc" } }),
      tx.auditEvent.groupBy({ by: ["actorMembershipId"], where: base, _count: { _all: true } }),
    ]);
    return {
      entityTypes: types.map((t) => ({ value: t.entityType, count: t._count._all })),
      actions: actions.map((a) => ({ value: a.action, count: a._count._all })),
      actorMembershipIds: actors.map((a) => ({ membershipId: a.actorMembershipId, count: a._count._all })),
    };
  });
}
