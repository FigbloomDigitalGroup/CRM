import type { LeadPoolRequestStatus } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

/** Data access for `lead_pool_requests` (FIG-1031). Every call runs inside the organisation's RLS context. */

const INCLUDE = {
  lead: { select: { id: true, ownerMembershipId: true, company: { select: { name: true } }, contact: { select: { firstName: true, lastName: true } } } },
} as const;

export function createPoolRequest(input: { organizationId: string; leadId: string; requesterMembershipId: string; note?: string | null }) {
  return withOrgContext(input.organizationId, (tx) => tx.leadPoolRequest.create({ data: input, include: INCLUDE }));
}

export function findPendingRequest(organizationId: string, leadId: string, requesterMembershipId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.leadPoolRequest.findFirst({ where: { organizationId, leadId, requesterMembershipId, status: "PENDING" }, include: INCLUDE }),
  );
}

export function getPoolRequest(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.leadPoolRequest.findFirst({ where: { id, organizationId }, include: INCLUDE }));
}

export function listPoolRequests(organizationId: string, filter: { status?: LeadPoolRequestStatus; requesterMembershipId?: string }, paging: { skip: number; take: number }) {
  const where = { organizationId, ...(filter.status ? { status: filter.status } : {}), ...(filter.requesterMembershipId ? { requesterMembershipId: filter.requesterMembershipId } : {}) };
  return withOrgContext(organizationId, async (tx) => {
    const [items, total] = await Promise.all([
      tx.leadPoolRequest.findMany({ where, include: INCLUDE, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: paging.skip, take: paging.take }),
      tx.leadPoolRequest.count({ where }),
    ]);
    return { items, total };
  });
}

/** Moves a pending request to its answer; only a still-pending one changes. Returns whether it did. */
export function decidePoolRequest(
  organizationId: string,
  id: string,
  data: { status: LeadPoolRequestStatus; decisionReason?: string | null; decidedByMembershipId?: string | null },
) {
  return withOrgContext(organizationId, async (tx) => {
    const { count } = await tx.leadPoolRequest.updateMany({
      where: { id, organizationId, status: "PENDING" },
      data: { ...data, decidedAt: new Date() },
    });
    return count === 1;
  });
}

/** Every other pending request for the lead, which a taken lead makes moot. Returns them so the people can be told. */
export function supersedePendingForLead(organizationId: string, leadId: string, exceptId: string) {
  return withOrgContext(organizationId, async (tx) => {
    const others = await tx.leadPoolRequest.findMany({ where: { organizationId, leadId, status: "PENDING", id: { not: exceptId } }, select: { id: true, requesterMembershipId: true } });
    if (others.length > 0) {
      await tx.leadPoolRequest.updateMany({
        where: { id: { in: others.map((o) => o.id) }, status: "PENDING" },
        data: { status: "SUPERSEDED", decidedAt: new Date(), decisionReason: "The lead was taken by someone else." },
      });
    }
    return others;
  });
}
