import { NotFoundError, ValidationError } from "../auth/errors";
import type { PlatformContext } from "../auth/platformSession";
import { adminDb } from "../db/adminClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import { recordPlatformAudit } from "./platformAuditService";

/**
 * Suspend, reactivate and offboard (FIG-1137, B6.05; screens PL5, OS1).
 *
 * The state machine, with who may move it:
 *
 *   ACTIVE      --suspend-->     SUSPENDED
 *   ACTIVE      --offboard-->    OFFBOARDING
 *   SUSPENDED   --reactivate-->  ACTIVE
 *   SUSPENDED   --offboard-->    OFFBOARDING
 *   OFFBOARDING --reactivate-->  ACTIVE         (only while no deletion has been approved)
 *   OFFBOARDING --(deletion, B6.09)--> OFFBOARDED   (terminal: data deleted, the row stays as a tombstone)
 *
 * Every move needs a written reason, and is recorded three times in the same
 * transaction as the change: the organisation's status row, the lifecycle trail
 * (`organization_lifecycle_events`, with the reason) and the tamper-evident
 * platform audit log. The change is enforced where the tenant app serves data
 * (`resolveActiveMembership`, `claimJob`), not here.
 */

export type LifecycleAction = "suspend" | "reactivate" | "offboard";
export type ManagedStatus = "ACTIVE" | "SUSPENDED" | "OFFBOARDING" | "OFFBOARDED";

export const REASON_MIN = 5;
export const REASON_MAX = 500;

const TARGET: Record<LifecycleAction, ManagedStatus> = { suspend: "SUSPENDED", reactivate: "ACTIVE", offboard: "OFFBOARDING" };
const ALLOWED_FROM: Record<LifecycleAction, string[]> = {
  suspend: ["ACTIVE"],
  reactivate: ["SUSPENDED", "OFFBOARDING"],
  offboard: ["ACTIVE", "SUSPENDED"],
};
const AUDIT_ACTION: Record<LifecycleAction, string> = {
  suspend: "organization.suspended",
  reactivate: "organization.reactivated",
  offboard: "organization.offboarding_started",
};

export function cleanReason(raw: string | undefined | null): string {
  const reason = (raw ?? "").trim();
  if (reason.length < REASON_MIN) {
    throw new ValidationError(`A reason of at least ${REASON_MIN} characters is required.`, [{ path: "reason", message: `Say why (at least ${REASON_MIN} characters).` }]);
  }
  if (reason.length > REASON_MAX) {
    throw new ValidationError(`Keep the reason under ${REASON_MAX} characters.`, [{ path: "reason", message: `At most ${REASON_MAX} characters.` }]);
  }
  return reason;
}

export interface TransitionResult {
  organizationId: string;
  slug: string;
  from: string;
  to: string;
  action: LifecycleAction;
}

export async function transitionOrganization(
  actor: Pick<PlatformContext, "identityId" | "email">,
  organizationId: string,
  action: LifecycleAction,
  rawReason: string | undefined,
  options: { requestId?: string | null } = {},
): Promise<TransitionResult> {
  const reason = cleanReason(rawReason);
  const to = TARGET[action];

  const result = await adminDb.$transaction(async (tx) => {
    // Lock the row so two admins cannot move the same organisation at once.
    const locked = await tx.$queryRaw<{ id: string; slug: string; status: string }[]>`
      SELECT id, slug, status::text AS status FROM organizations WHERE id = ${organizationId} FOR UPDATE`;
    const org = locked[0];
    if (!org) throw new NotFoundError("Organization", organizationId);

    if (!ALLOWED_FROM[action].includes(org.status)) {
      const message =
        org.status === "OFFBOARDED"
          ? "This organisation has been offboarded and its data deleted; it cannot be changed."
          : org.status === to
            ? `The organisation is already ${to.toLowerCase()}.`
            : `An organisation that is ${org.status.toLowerCase()} cannot be ${action === "suspend" ? "suspended" : action === "reactivate" ? "reactivated" : "offboarded"}.`;
      throw new ValidationError(message, [{ path: "status", message, code: "INVALID_TRANSITION" }]);
    }

    if (action === "reactivate" && org.status === "OFFBOARDING") {
      const approved = await tx.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n FROM platform_data_requests
        WHERE organization_id = ${organizationId} AND kind = 'DELETE' AND status = 'APPROVED'`;
      if (Number(approved[0]?.n ?? 0) > 0) {
        const message = "A deletion has been approved for this organisation. Cancel that request first (with a reason) before reactivating.";
        throw new ValidationError(message, [{ path: "status", message, code: "DELETION_APPROVED" }]);
      }
    }

    await tx.$executeRaw`UPDATE organizations SET status = ${to}::"OrganizationStatus", updated_at = now() WHERE id = ${organizationId}`;
    await tx.organizationLifecycleEvent.create({
      data: { organizationId, fromStatus: org.status, toStatus: to, action, reason, actorIdentityId: actor.identityId },
    });
    await recordPlatformAudit(tx, {
      actorIdentityId: actor.identityId,
      actorLabel: actor.email,
      action: AUDIT_ACTION[action],
      targetType: "Organization",
      targetId: organizationId,
      organizationId,
      organizationSlug: org.slug,
      reason,
      metadata: { from: org.status, to },
      requestId: options.requestId ?? null,
    });
    return { organizationId, slug: org.slug, from: org.status, to, action } satisfies TransitionResult;
  });

  // The organisation's own history shows that its status changed (no reason: that is between the platform and the organisation's contact).
  await recordAuditEvent({
    organizationId,
    action: AUDIT_ACTION[action],
    entityType: "Organization",
    entityId: organizationId,
    metadata: { from: result.from, to: result.to },
  });
  return result;
}
