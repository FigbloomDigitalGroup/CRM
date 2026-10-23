import { Prisma, type HandoffStatus } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

export interface CreateDealHandoffInput {
  organizationId: string;
  dealId: string;
  /** Null means "owner later": the handoff waits for someone in Delivery to take it (FIG-1037). */
  deliveryOwnerMembershipId: string | null;
  createdByMembershipId: string;
  startDate?: Date | null;
  scope?: string | null;
  requirements?: string | null;
  deliverables?: { title: string; done: boolean }[];
  teamMembershipIds?: string[];
}

/**
 * Claims the handoff for a deal (FIG-792). The unique `dealId` makes this
 * the idempotency gate: returns `null` instead of throwing when the deal
 * has already been handed off, so a deal that is re-opened and won again
 * (or two requests winning it at once) never produces a second set of
 * tasks or notifications.
 */
export async function createDealHandoff(input: CreateDealHandoffInput) {
  try {
    return await withOrgContext(input.organizationId, (tx) =>
      tx.dealHandoff.create({
        data: {
          organizationId: input.organizationId,
          dealId: input.dealId,
          deliveryOwnerMembershipId: input.deliveryOwnerMembershipId,
          createdByMembershipId: input.createdByMembershipId,
          status: input.deliveryOwnerMembershipId ? "ONBOARDING" : "AWAITING_OWNER",
          startDate: input.startDate ?? null,
          scope: input.scope ?? null,
          requirements: input.requirements ?? null,
          deliverables: input.deliverables ?? [],
          teamMembershipIds: input.teamMembershipIds ?? [],
          ownerTakenAt: input.deliveryOwnerMembershipId ? new Date() : null,
        },
      }),
    );
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return null;
    }
    throw err;
  }
}

export async function findDealHandoff(organizationId: string, dealId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.dealHandoff.findFirst({ where: { organizationId, dealId } }),
  );
}

export async function getDealHandoffById(organizationId: string, handoffId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.dealHandoff.findFirst({ where: { organizationId, id: handoffId } }),
  );
}

/** Only used to undo a claim whose follow-up steps failed, so a retry can start clean. */
export async function deleteDealHandoff(organizationId: string, handoffId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.dealHandoff.deleteMany({ where: { id: handoffId, organizationId } }),
  );
}

/**
 * Someone in Delivery takes an ownerless handoff. One conditional statement:
 * it matches only while the handoff still has no owner, so of two people
 * taking it at once exactly one gets it. Returns whether this call did.
 */
export async function takeOwnerlessHandoff(organizationId: string, handoffId: string, membershipId: string) {
  return withOrgContext(organizationId, async (tx) => {
    const { count } = await tx.dealHandoff.updateMany({
      where: { id: handoffId, organizationId, deliveryOwnerMembershipId: null, status: "AWAITING_OWNER" },
      data: { deliveryOwnerMembershipId: membershipId, status: "ONBOARDING", ownerTakenAt: new Date() },
    });
    return count === 1;
  });
}

export async function updateDealHandoffRecord(organizationId: string, handoffId: string, data: Prisma.DealHandoffUncheckedUpdateInput) {
  return withOrgContext(organizationId, (tx) =>
    tx.dealHandoff.update({ where: { id: handoffId, organizationId }, data }),
  );
}

export async function markTasksCreated(organizationId: string, handoffId: string) {
  return withOrgContext(organizationId, async (tx) => {
    const { count } = await tx.dealHandoff.updateMany({
      where: { id: handoffId, organizationId, tasksCreatedAt: null },
      data: { tasksCreatedAt: new Date() },
    });
    return count === 1;
  });
}

export interface ListHandoffsFilter {
  status?: HandoffStatus;
  /** Handoffs this membership owns. */
  ownerMembershipId?: string;
  /** Only handoffs on deals owned by this membership (a salesperson's own deals). */
  dealOwnerMembershipId?: string;
}

export async function listDealHandoffs(organizationId: string, filter: ListHandoffsFilter, paging: { skip: number; take: number }) {
  const where: Prisma.DealHandoffWhereInput = {
    organizationId,
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.ownerMembershipId ? { deliveryOwnerMembershipId: filter.ownerMembershipId } : {}),
    ...(filter.dealOwnerMembershipId ? { deal: { ownerMembershipId: filter.dealOwnerMembershipId } } : {}),
  };
  return withOrgContext(organizationId, async (tx) => {
    const [items, total] = await Promise.all([
      tx.dealHandoff.findMany({
        where,
        include: { deal: { select: { id: true, ownerMembershipId: true, company: { select: { id: true, name: true } }, service: { select: { id: true, name: true } } } } },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: paging.skip,
        take: paging.take,
      }),
      tx.dealHandoff.count({ where }),
    ]);
    return { items, total };
  });
}

export async function countHandoffsByStatus(organizationId: string, filter: ListHandoffsFilter = {}) {
  return withOrgContext(organizationId, async (tx) => {
    const rows = await tx.dealHandoff.groupBy({
      by: ["status"],
      where: {
        organizationId,
        ...(filter.ownerMembershipId ? { deliveryOwnerMembershipId: filter.ownerMembershipId } : {}),
        ...(filter.dealOwnerMembershipId ? { deal: { ownerMembershipId: filter.dealOwnerMembershipId } } : {}),
      },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all])) as Partial<Record<HandoffStatus, number>>;
  });
}
