import { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

export interface CreateDealHandoffInput {
  organizationId: string;
  dealId: string;
  deliveryOwnerMembershipId: string;
  createdByMembershipId: string;
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
      tx.dealHandoff.create({ data: input }),
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

/** Only used to undo a claim whose follow-up steps failed, so a retry can start clean. */
export async function deleteDealHandoff(organizationId: string, handoffId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.dealHandoff.deleteMany({ where: { id: handoffId, organizationId } }),
  );
}
