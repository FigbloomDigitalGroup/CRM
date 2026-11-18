import type { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

/**
 * Queries behind the Customer 360 page (FIG-1047, B3.01). Each section is one call (or two), whatever the number of
 * records, and every call filters on indexed columns. Who may see a row is decided by the caller, which passes the
 * visibility filter in; nothing here widens it.
 */

export function companyDeals(organizationId: string, companyId: string, visible: Prisma.DealWhereInput, take: number) {
  return withOrgContext(organizationId, async (tx) => {
    const where = { organizationId, companyId, ...visible };
    const [rows, total] = await Promise.all([
      tx.deal.findMany({
        where,
        orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }, { id: "asc" }],
        take,
        include: { pipelineStage: { select: { name: true } }, service: { select: { name: true } }, owner: { select: { id: true, user: { select: { name: true } } } } },
      }),
      tx.deal.count({ where }),
    ]);
    return { rows, total };
  });
}

export function companyOpenTasks(organizationId: string, companyId: string, visible: Prisma.TaskWhereInput, take: number) {
  return withOrgContext(organizationId, async (tx) => {
    const where: Prisma.TaskWhereInput = { organizationId, companyId, status: { in: ["PENDING", "IN_PROGRESS"] }, archivedAt: null, ...visible };
    const [rows, total] = await Promise.all([
      tx.task.findMany({
        where,
        orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        take,
        include: { assignee: { select: { id: true, user: { select: { name: true } } } } },
      }),
      tx.task.count({ where }),
    ]);
    return { rows, total };
  });
}

export function companyHandoffs(organizationId: string, companyId: string, visibleDeal: Prisma.DealWhereInput) {
  return withOrgContext(organizationId, (tx) =>
    tx.dealHandoff.findMany({
      where: { organizationId, deal: { companyId, ...visibleDeal } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 50,
      select: {
        id: true,
        dealId: true,
        status: true,
        startDate: true,
        deliveryOwnerMembershipId: true,
        ownerTakenAt: true,
        deliveredAt: true,
        createdAt: true,
      },
    }),
  );
}

export function companyServiceLinks(organizationId: string, companyId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.companyService.findMany({
      where: { organizationId, companyId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
      include: { service: { select: { name: true } } },
    }),
  );
}

export function companyInvoices(organizationId: string, companyId: string) {
  return withOrgContext(organizationId, async (tx) => {
    const invoices = await tx.invoice.findMany({
      where: { organizationId, companyId },
      orderBy: [{ dueOn: "asc" }, { id: "asc" }],
      take: 100,
      include: { payments: { where: { reversedAt: null }, select: { amount: true } }, company: { select: { id: true, name: true } } },
    });
    const dealIds = [...new Set(invoices.map((i) => i.dealId).filter((d): d is string => !!d))];
    const notes = await tx.dealPaymentNote.findMany({ where: { organizationId, deal: { companyId } }, orderBy: { updatedAt: "desc" }, take: 50 });
    void dealIds;
    return { invoices, notes };
  });
}

export interface TimelineCursor {
  at: Date;
  id: string;
}

const before = (c: TimelineCursor | null, field: "occurredAt" | "createdAt") =>
  c ? { OR: [{ [field]: { lt: c.at } }, { [field]: c.at, id: { lt: c.id } }] } : {};

export function timelineActivities(organizationId: string, companyId: string, visible: Prisma.ActivityWhereInput, cursor: TimelineCursor | null, take: number) {
  return withOrgContext(organizationId, (tx) =>
    tx.activity.findMany({
      where: { AND: [{ organizationId, OR: [{ companyId }, { contact: { companyId } }], communications: { none: {} } }, visible, before(cursor, "occurredAt")] },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take,
    }),
  );
}

export function timelineCommunications(organizationId: string, companyId: string, visible: Prisma.CommunicationWhereInput, cursor: TimelineCursor | null, take: number) {
  return withOrgContext(organizationId, (tx) =>
    tx.communication.findMany({
      where: { AND: [{ organizationId, needsLinking: false, dismissedAt: null, OR: [{ companyId }, { contact: { companyId } }] }, visible, before(cursor, "occurredAt")] },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take,
    }),
  );
}

export function timelineLifecycle(organizationId: string, companyId: string, cursor: TimelineCursor | null, take: number) {
  return withOrgContext(organizationId, (tx) =>
    tx.lifecycleEvent.findMany({
      where: { AND: [{ organizationId, companyId }, before(cursor, "createdAt")] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
    }),
  );
}

export function timelineAudit(organizationId: string, companyId: string, cursor: TimelineCursor | null, take: number) {
  return withOrgContext(organizationId, (tx) =>
    tx.auditEvent.findMany({
      where: { AND: [{ organizationId, entityType: "Company", entityId: companyId, action: { not: "company.lifecycle_state_changed" } }, before(cursor, "createdAt")] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
    }),
  );
}

export function lifecycleStateNames(organizationId: string) {
  return withOrgContext(organizationId, (tx) => tx.customerLifecycleState.findMany({ where: { organizationId }, select: { id: true, key: true, name: true } }));
}

export function membershipNames(organizationId: string, ids: string[]) {
  if (ids.length === 0) return Promise.resolve([] as { id: string; user: { name: string } }[]);
  return withOrgContext(organizationId, (tx) => tx.membership.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, user: { select: { name: true } } } }));
}
