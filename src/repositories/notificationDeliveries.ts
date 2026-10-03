import type { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

export interface CreateNotificationDeliveryInput {
  organizationId: string;
  notificationId?: string;
  channel: "EMAIL" | "SMS" | "WHATSAPP";
  recipientEmail?: string;
  recipientPhone?: string;
  templateKey: string;
  payload?: Prisma.InputJsonValue;
}

export async function createNotificationDelivery(
  input: CreateNotificationDeliveryInput,
) {
  return withOrgContext(input.organizationId, (tx) =>
    tx.notificationDelivery.create({ data: input }),
  );
}

export async function markDeliverySent(
  organizationId: string,
  deliveryId: string,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.notificationDelivery.update({
      where: { id: deliveryId, organizationId },
      data: { status: "SENT", sentAt: new Date(), lastError: null },
    }),
  );
}

/**
 * Exponential-ish backoff (minutes): 1, 5, 25, 125, ... capped at 24h --
 * there's no job queue to hand retries to (see docs/DEPLOYMENT.md), so
 * `nextAttemptAt` is what `scripts/notifications-sweep.ts` polls against.
 */
export function computeNextAttemptDelayMs(attempts: number): number {
  const minutes = Math.min(5 ** attempts, 24 * 60);
  return minutes * 60 * 1000;
}

export async function markDeliveryFailed(
  organizationId: string,
  deliveryId: string,
  attempts: number,
  maxAttempts: number,
  errorMessage: string,
) {
  const exhausted = attempts >= maxAttempts;
  return withOrgContext(organizationId, (tx) =>
    tx.notificationDelivery.update({
      where: { id: deliveryId, organizationId },
      data: {
        status: exhausted ? "EXHAUSTED" : "FAILED",
        attempts,
        lastError: errorMessage.slice(0, 2000),
        nextAttemptAt: exhausted
          ? undefined
          : new Date(Date.now() + computeNextAttemptDelayMs(attempts)),
      },
    }),
  );
}

export async function listDueDeliveries(organizationId: string, limit = 100) {
  return withOrgContext(organizationId, (tx) =>
    tx.notificationDelivery.findMany({
      where: {
        organizationId,
        status: { in: ["PENDING", "FAILED"] },
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: { nextAttemptAt: "asc" },
      take: limit,
    }),
  );
}
