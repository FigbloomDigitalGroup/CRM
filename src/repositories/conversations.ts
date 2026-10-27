import type { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

/** Data access for the Conversations hub (FIG-1053, B3.07). Every call runs inside the organisation's RLS context. */

const communicationInclude = {
  company: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.CommunicationInclude;

const activityInclude = {
  company: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ActivityInclude;

export type CommunicationRow = Prisma.CommunicationGetPayload<{ include: typeof communicationInclude }>;
export type ActivityRow = Prisma.ActivityGetPayload<{ include: typeof activityInclude }>;

export function listCommunicationRows(organizationId: string, where: Prisma.CommunicationWhereInput, take: number, skip = 0) {
  return withOrgContext(organizationId, async (tx) => {
    const full = { ...where, organizationId };
    const [rows, total] = await Promise.all([
      tx.communication.findMany({ where: full, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take, skip, include: communicationInclude }),
      tx.communication.count({ where: full }),
    ]);
    return { rows, total };
  });
}

export function countCommunications(organizationId: string, where: Prisma.CommunicationWhereInput) {
  return withOrgContext(organizationId, (tx) => tx.communication.count({ where: { ...where, organizationId } }));
}

export function listActivityRows(organizationId: string, where: Prisma.ActivityWhereInput, take: number, skip = 0) {
  return withOrgContext(organizationId, async (tx) => {
    const full = { ...where, organizationId };
    const [rows, total] = await Promise.all([
      tx.activity.findMany({ where: full, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take, skip, include: activityInclude }),
      tx.activity.count({ where: full }),
    ]);
    return { rows, total };
  });
}

export function countActivities(organizationId: string, where: Prisma.ActivityWhereInput) {
  return withOrgContext(organizationId, (tx) => tx.activity.count({ where: { ...where, organizationId } }));
}

export function getCommunicationRow(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.communication.findFirst({ where: { id, organizationId }, include: communicationInclude }));
}

export function updateCommunicationRow(organizationId: string, id: string, data: Prisma.CommunicationUncheckedUpdateInput) {
  return withOrgContext(organizationId, (tx) => tx.communication.update({ where: { id, organizationId }, data, include: communicationInclude }));
}

/** Moves a waiting message to a record only if it is still waiting, so two people linking at once cannot both win. */
export function claimWaitingCommunication(organizationId: string, id: string, data: Prisma.CommunicationUncheckedUpdateManyInput) {
  return withOrgContext(organizationId, (tx) => tx.communication.updateMany({ where: { id, organizationId, needsLinking: true, dismissedAt: null }, data }));
}

export function touchDealActivity(organizationId: string, dealId: string, at: Date) {
  return withOrgContext(organizationId, (tx) => tx.deal.updateMany({ where: { id: dealId, organizationId, lastActivityAt: { lt: at } }, data: { lastActivityAt: at } }));
}
