import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { maskAuditSnapshot } from "../auth/masking";
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
  const events = await listAuditEventsForEntity(ctx.organizationId, entityType, entityId);
  // Before/after snapshots of a deal carry its value; show them only to someone who may see it (B2.07).
  return events.map((event) => ({
    ...event,
    previousValue: maskAuditSnapshot(ctx, entityType, event.previousValue) as typeof event.previousValue,
    newValue: maskAuditSnapshot(ctx, entityType, event.newValue) as typeof event.newValue,
    metadata: maskAuditSnapshot(ctx, entityType, event.metadata) as typeof event.metadata,
  }));
}
