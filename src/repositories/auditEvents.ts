import { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

export interface RecordAuditEventInput {
  organizationId: string;
  actorMembershipId?: string;
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  previousValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Audit events are append-only: the `figbloom_app` role has UPDATE/DELETE
 * revoked on this table at the database level (see
 * prisma/migrations/*_tenant_integrity_and_rls), so this function only ever
 * needs (and only ever should) call `create`.
 */
export async function recordAuditEvent(input: RecordAuditEventInput) {
  return withOrgContext(input.organizationId, (tx) =>
    tx.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorMembershipId: input.actorMembershipId,
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        previousValue: input.previousValue,
        newValue: input.newValue,
        metadata: input.metadata,
      },
    }),
  );
}

export async function listAuditEventsForEntity(
  organizationId: string,
  entityType: string,
  entityId: string,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.auditEvent.findMany({
      where: { organizationId, entityType, entityId },
      orderBy: { createdAt: "asc" },
    }),
  );
}
