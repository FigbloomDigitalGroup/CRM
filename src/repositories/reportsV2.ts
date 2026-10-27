import { withOrgContext } from "../db/orgScopedClient";

/**
 * Aggregations for Reports v2 and My metrics (FIG-1055, B3.09). Every figure is computed in SQL (`groupBy`, `count`,
 * `aggregate`); nothing here loads the records themselves.
 */

export interface Window {
  from?: Date;
  /** Exclusive upper bound. */
  to?: Date;
}

const range = (w: Window) => (w.from || w.to ? { ...(w.from ? { gte: w.from } : {}), ...(w.to ? { lt: w.to } : {}) } : undefined);

export function leadsBySourceAndConversion(organizationId: string, w: Window, ownerMembershipId?: string) {
  return withOrgContext(organizationId, async (tx) => {
    const where = { organizationId, createdAt: range(w), ...(ownerMembershipId ? { ownerMembershipId } : {}) };
    const [all, converted] = await Promise.all([
      tx.lead.groupBy({ by: ["leadSourceId"], where, _count: { _all: true } }),
      tx.lead.groupBy({ by: ["leadSourceId"], where: { ...where, convertedAt: { not: null } }, _count: { _all: true } }),
    ]);
    return { all, converted };
  });
}

export function leadsByStatusAndConversion(organizationId: string, w: Window, ownerMembershipId?: string) {
  return withOrgContext(organizationId, async (tx) => {
    const where = { organizationId, createdAt: range(w), ...(ownerMembershipId ? { ownerMembershipId } : {}) };
    const [all, converted] = await Promise.all([
      tx.lead.groupBy({ by: ["leadStatusId"], where, _count: { _all: true } }),
      tx.lead.groupBy({ by: ["leadStatusId"], where: { ...where, convertedAt: { not: null } }, _count: { _all: true } }),
    ]);
    return { all, converted };
  });
}

export function openPipelineByStage(organizationId: string, ownerMembershipId?: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.deal.groupBy({
      by: ["pipelineStageId"],
      where: { organizationId, outcome: "OPEN", archivedAt: null, ...(ownerMembershipId ? { ownerMembershipId } : {}) },
      _count: { _all: true },
      _sum: { value: true },
    }),
  );
}

export function lostByReason(organizationId: string, w: Window, ownerMembershipId?: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.deal.groupBy({
      by: ["lostReasonId"],
      where: { organizationId, outcome: "LOST", lostAt: range(w), ...(ownerMembershipId ? { ownerMembershipId } : {}) },
      _count: { _all: true },
      _sum: { value: true },
    }),
  );
}

export function wonByOwner(organizationId: string, w: Window) {
  return withOrgContext(organizationId, (tx) =>
    tx.deal.groupBy({ by: ["ownerMembershipId"], where: { organizationId, outcome: "WON", wonAt: range(w) }, _count: { _all: true }, _sum: { value: true } }),
  );
}

export function leadsByOwner(organizationId: string, w: Window) {
  return withOrgContext(organizationId, async (tx) => {
    const where = { organizationId, createdAt: range(w), ownerMembershipId: { not: null } };
    const [all, converted] = await Promise.all([
      tx.lead.groupBy({ by: ["ownerMembershipId"], where, _count: { _all: true } }),
      tx.lead.groupBy({ by: ["ownerMembershipId"], where: { ...where, convertedAt: { not: null } }, _count: { _all: true } }),
    ]);
    return { all, converted };
  });
}

export function tasksCompletedByAssignee(organizationId: string, w: Window) {
  return withOrgContext(organizationId, (tx) =>
    tx.task.groupBy({ by: ["assigneeMembershipId"], where: { organizationId, status: "COMPLETED", completedAt: range(w) }, _count: { _all: true } }),
  );
}

export function sourceNames(organizationId: string) {
  return withOrgContext(organizationId, (tx) => tx.leadSource.findMany({ where: { organizationId }, select: { id: true, name: true } }));
}
export function leadStatusNames(organizationId: string) {
  return withOrgContext(organizationId, (tx) => tx.leadStatus.findMany({ where: { organizationId }, select: { id: true, name: true, sequence: true }, orderBy: { sequence: "asc" } }));
}
export function stageNames(organizationId: string) {
  return withOrgContext(organizationId, (tx) => tx.pipelineStage.findMany({ where: { organizationId }, select: { id: true, name: true, sequence: true }, orderBy: { sequence: "asc" } }));
}
export function lostReasonNames(organizationId: string) {
  return withOrgContext(organizationId, (tx) => tx.lostReason.findMany({ where: { organizationId }, select: { id: true, name: true } }));
}
export function memberNames(organizationId: string) {
  return withOrgContext(organizationId, (tx) => tx.membership.findMany({ where: { organizationId }, select: { id: true, user: { select: { name: true } } } }));
}

/** Counts for the personal metrics of one person. */
export function personalCounts(organizationId: string, me: string, w: Window, now: Date) {
  return withOrgContext(organizationId, async (tx) => {
    const created = range(w);
    const [leads, converted, wonDeals, openDeals, tasksDone, tasksOverdue, tasksOpen, calls, handoffsTaken, handoffsDelivered, onboarding, invoicesCreated, paymentsRecorded, notesUpdated] = await Promise.all([
      tx.lead.count({ where: { organizationId, ownerMembershipId: me, createdAt: created } }),
      tx.lead.count({ where: { organizationId, ownerMembershipId: me, createdAt: created, convertedAt: { not: null } } }),
      tx.deal.aggregate({ where: { organizationId, ownerMembershipId: me, outcome: "WON", wonAt: created }, _count: { _all: true }, _sum: { value: true } }),
      tx.deal.aggregate({ where: { organizationId, ownerMembershipId: me, outcome: "OPEN", archivedAt: null }, _count: { _all: true }, _sum: { value: true } }),
      tx.task.count({ where: { organizationId, assigneeMembershipId: me, status: "COMPLETED", completedAt: created } }),
      tx.task.count({ where: { organizationId, assigneeMembershipId: me, status: { in: ["PENDING", "IN_PROGRESS"] }, dueAt: { lt: now }, archivedAt: null } }),
      tx.task.count({ where: { organizationId, assigneeMembershipId: me, status: { in: ["PENDING", "IN_PROGRESS"] }, archivedAt: null } }),
      tx.activity.count({ where: { organizationId, authorMembershipId: me, type: { in: ["CALL", "WHATSAPP"] }, occurredAt: created } }),
      tx.dealHandoff.count({ where: { organizationId, deliveryOwnerMembershipId: me, createdAt: created } }),
      tx.dealHandoff.count({ where: { organizationId, deliveredByMembershipId: me, deliveredAt: created } }),
      tx.dealHandoff.count({ where: { organizationId, deliveryOwnerMembershipId: me, status: "ONBOARDING" } }),
      tx.invoice.count({ where: { organizationId, createdByMembershipId: me, createdAt: created } }),
      tx.paymentRecord.aggregate({ where: { organizationId, recordedByMembershipId: me, reversedAt: null, createdAt: created }, _count: { _all: true }, _sum: { amount: true } }),
      tx.dealPaymentNote.count({ where: { organizationId, updatedByMembershipId: me, updatedAt: created } }),
    ]);
    return { leads, converted, wonDeals, openDeals, tasksDone, tasksOverdue, tasksOpen, calls, handoffsTaken, handoffsDelivered, onboarding, invoicesCreated, paymentsRecorded, notesUpdated };
  });
}
