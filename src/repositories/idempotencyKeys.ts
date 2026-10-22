import { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

export interface IdempotencyScope {
  organizationId: string;
  membershipId: string;
  key: string;
}

/** Keys older than this are forgotten; a client retrying later than a day gets a fresh create. */
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * Claims a key for a new request. Returns the new row, or null when the key
 * already exists (the unique index is the gate, so two concurrent requests
 * with one key can never both run).
 */
export async function claimIdempotencyKey(
  scope: IdempotencyScope,
  request: { method: string; path: string; requestHash: string },
) {
  try {
    return await withOrgContext(scope.organizationId, async (tx) => {
      // Cheap housekeeping on the same path that writes the rows.
      await tx.idempotencyKey.deleteMany({
        where: {
          organizationId: scope.organizationId,
          createdAt: { lt: new Date(Date.now() - IDEMPOTENCY_RETENTION_MS) },
        },
      });
      return tx.idempotencyKey.create({
        data: { ...scope, ...request },
      });
    });
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

export async function findIdempotencyKey(scope: IdempotencyScope) {
  return withOrgContext(scope.organizationId, (tx) =>
    tx.idempotencyKey.findFirst({
      where: {
        organizationId: scope.organizationId,
        membershipId: scope.membershipId,
        key: scope.key,
      },
    }),
  );
}

export async function completeIdempotencyKey(
  organizationId: string,
  id: string,
  response: { status: number; body: Prisma.InputJsonValue },
) {
  return withOrgContext(organizationId, (tx) =>
    tx.idempotencyKey.updateMany({
      where: { id, organizationId },
      data: {
        status: "COMPLETED",
        responseStatus: response.status,
        responseBody: response.body,
        completedAt: new Date(),
      },
    }),
  );
}

/** Frees a key whose request failed, so the client's retry runs again instead of being refused. */
export async function releaseIdempotencyKey(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.idempotencyKey.deleteMany({ where: { id, organizationId } }),
  );
}
