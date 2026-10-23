import type { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

/** Data access for `deal_moves` (FIG-1035). Every call runs inside the organisation's RLS context. */

export function createDealMove(input: {
  organizationId: string;
  dealId: string;
  fromStageId: string;
  toStageId: string;
  movedByMembershipId: string;
  undoExpiresAt: Date;
  previous: Prisma.InputJsonValue;
}) {
  return withOrgContext(input.organizationId, (tx) => tx.dealMove.create({ data: input }));
}

export function getDealMove(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.dealMove.findFirst({ where: { id, organizationId } }));
}

export function markMoveUndone(organizationId: string, id: string) {
  return withOrgContext(organizationId, async (tx) => {
    const { count } = await tx.dealMove.updateMany({ where: { id, organizationId, undoneAt: null }, data: { undoneAt: new Date() } });
    return count === 1;
  });
}

/** The latest move of a deal that has not been undone, to know whether "undo" is still on offer. */
export function latestOpenMove(organizationId: string, dealId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.dealMove.findFirst({ where: { organizationId, dealId, undoneAt: null }, orderBy: { movedAt: "desc" } }),
  );
}
