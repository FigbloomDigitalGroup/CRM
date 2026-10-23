import { adminDb } from "../db/adminClient";
import { recordAuditEvent } from "../repositories/auditEvents";

export type AuthAuditAction =
  | "auth.login"
  | "auth.logout"
  | "auth.password_reset"
  | "auth.locked_out"
  | "auth.unlocked"
  | "auth.session_revoked"
  | "auth.other_sessions_revoked"
  | "auth.session_extended";

/**
 * Account-level events belong to every organisation the person is a member of
 * (their Management users can see them in that organisation's audit history),
 * so one entry is written per membership. Removed memberships are left out:
 * that organisation no longer has any claim on the person's account activity.
 */
export async function recordAuthAuditEvent(
  userId: string,
  action: AuthAuditAction,
  metadata?: Record<string, string | number | boolean | null>,
) {
  const memberships = await adminDb.membership.findMany({
    where: { userId, status: { in: ["ACTIVE", "INACTIVE", "PENDING"] } },
    select: { id: true, organizationId: true },
  });
  await Promise.all(
    memberships.map((m) =>
      recordAuditEvent({
        organizationId: m.organizationId,
        actorMembershipId: m.id,
        actorUserId: userId,
        action,
        entityType: "User",
        entityId: userId,
        ...(metadata ? { metadata } : {}),
      }),
    ),
  );
}
