import { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

export interface CreateNotificationInput {
  organizationId: string;
  membershipId: string;
  type: "LEAD_ASSIGNED" | "TASK_DUE" | "TASK_OVERDUE";
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  link?: string;
}

/**
 * Returns `null` instead of throwing when this (organization, membership,
 * type, entityType, entityId) combination was already notified -- the
 * unique index exists precisely so the due/overdue generator script can
 * re-run on every sweep without re-notifying the same thing twice (FIG-597).
 */
export async function createNotification(input: CreateNotificationInput) {
  try {
    return await withOrgContext(input.organizationId, (tx) =>
      tx.notification.create({ data: input }),
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

export interface ListNotificationsFilters {
  unreadOnly?: boolean;
  limit?: number;
}

export async function listNotificationsForMembership(
  organizationId: string,
  membershipId: string,
  filters: ListNotificationsFilters = {},
) {
  return withOrgContext(organizationId, (tx) =>
    tx.notification.findMany({
      where: {
        organizationId,
        membershipId,
        ...(filters.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: filters.limit ?? 50,
    }),
  );
}

export async function markNotificationRead(
  organizationId: string,
  membershipId: string,
  notificationId: string,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.notification.updateMany({
      where: { id: notificationId, organizationId, membershipId, readAt: null },
      data: { readAt: new Date() },
    }),
  );
}

export async function markAllNotificationsRead(
  organizationId: string,
  membershipId: string,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.notification.updateMany({
      where: { organizationId, membershipId, readAt: null },
      data: { readAt: new Date() },
    }),
  );
}
