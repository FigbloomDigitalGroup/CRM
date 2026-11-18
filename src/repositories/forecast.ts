import { withOrgContext } from "../db/orgScopedClient";

/** Data access for the forecast and `sales_targets` (FIG-1146). Every call runs inside the organisation's RLS context. */

export function listPipelineStages(organizationId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.pipelineStage.findMany({
      where: { organizationId },
      select: { id: true, key: true, name: true, sequence: true, probability: true, isWon: true, isLost: true, isActive: true },
      orderBy: { sequence: "asc" },
    }),
  );
}

export function listOpenDeals(organizationId: string, ownerMembershipId?: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.deal.findMany({
      where: { organizationId, outcome: "OPEN", archivedAt: null, ...(ownerMembershipId ? { ownerMembershipId } : {}) },
      select: { id: true, ownerMembershipId: true, pipelineStageId: true, value: true, expectedCloseDate: true },
    }),
  );
}

export function listWonDealsBetween(organizationId: string, from: Date, to: Date, ownerMembershipId?: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.deal.findMany({
      where: { organizationId, outcome: "WON", archivedAt: null, wonAt: { gte: from, lt: to }, ...(ownerMembershipId ? { ownerMembershipId } : {}) },
      select: { id: true, ownerMembershipId: true, value: true },
    }),
  );
}

export function listTargets(organizationId: string, periodStart: Date, membershipId?: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.salesTarget.findMany({ where: { organizationId, periodStart, ...(membershipId ? { membershipId } : {}) } }),
  );
}

export function memberNamesById(organizationId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.membership.findMany({ where: { organizationId }, select: { id: true, status: true, user: { select: { name: true } } } }),
  );
}

export async function upsertTarget(input: { organizationId: string; membershipId: string | null; periodStart: Date; amount: string; setBy: string }) {
  return withOrgContext(input.organizationId, async (tx) => {
    const existing = await tx.salesTarget.findFirst({
      where: { organizationId: input.organizationId, membershipId: input.membershipId, periodStart: input.periodStart },
    });
    if (existing) {
      const updated = await tx.salesTarget.update({ where: { id: existing.id }, data: { amount: input.amount, setByMembershipId: input.setBy } });
      return { before: existing, after: updated };
    }
    const created = await tx.salesTarget.create({
      data: { organizationId: input.organizationId, membershipId: input.membershipId, periodStart: input.periodStart, amount: input.amount, setByMembershipId: input.setBy },
    });
    return { before: null, after: created };
  });
}

export function deleteTarget(organizationId: string, membershipId: string | null, periodStart: Date) {
  return withOrgContext(organizationId, async (tx) => {
    const existing = await tx.salesTarget.findFirst({ where: { organizationId, membershipId, periodStart } });
    if (!existing) return null;
    await tx.salesTarget.delete({ where: { id: existing.id } });
    return existing;
  });
}
