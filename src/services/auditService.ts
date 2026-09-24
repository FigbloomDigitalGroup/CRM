import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { listAuditEventsForEntity } from "../repositories/auditEvents";

/**
 * `audit.view` is Management-only in the FIG-438 seed -- audit history is
 * an oversight/compliance surface, not a per-record detail every viewer
 * of that record should see.
 */
export async function listAuditHistory(
  ctx: AuthContext,
  entityType: string,
  entityId: string,
) {
  requirePermission(ctx, "audit.view");
  return listAuditEventsForEntity(ctx.organizationId, entityType, entityId);
}
