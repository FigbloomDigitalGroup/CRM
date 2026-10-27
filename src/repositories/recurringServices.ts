import type { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

/** Data access for `recurring_services` (FIG-1051, B3.05). Every call runs inside the organisation's RLS context. */

const include = {
  company: { select: { id: true, name: true, ownerMembershipId: true, archivedAt: true } },
  service: { select: { id: true, name: true } },
} satisfies Prisma.RecurringServiceInclude;

export type RecurringServiceRow = Prisma.RecurringServiceGetPayload<{ include: typeof include }>;

export function getRecurringRow(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.recurringService.findFirst({ where: { id, organizationId }, include }));
}

export function insertRecurring(data: Prisma.RecurringServiceUncheckedCreateInput) {
  return withOrgContext(data.organizationId, (tx) => tx.recurringService.create({ data, include }));
}

export function updateRecurringRow(organizationId: string, id: string, data: Prisma.RecurringServiceUncheckedUpdateInput) {
  return withOrgContext(organizationId, (tx) => tx.recurringService.update({ where: { id, organizationId }, data, include }));
}

export function listRecurringRows(
  organizationId: string,
  where: Prisma.RecurringServiceWhereInput,
  orderBy: Prisma.RecurringServiceOrderByWithRelationInput[],
  skip?: number,
  take?: number,
) {
  return withOrgContext(organizationId, async (tx) => {
    const full = { ...where, organizationId };
    const [rows, total] = await Promise.all([
      tx.recurringService.findMany({ where: full, orderBy, skip, take, include }),
      skip === undefined ? Promise.resolve(0) : tx.recurringService.count({ where: full }),
    ]);
    return { rows, total };
  });
}
