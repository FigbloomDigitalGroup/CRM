import { adminDb } from "../db/adminClient";

/**
 * Where an account stands with respect to organisations (B1.12). Signing up
 * creates an account with no organisation access, and admin actions can later
 * take access away; the UI needs one structured answer for the sign-in
 * response and `/api/me/context`:
 *
 *   active          at least one active membership
 *   awaitingAccess  none -- the account was never given one, only has an
 *                   unaccepted invite, or every membership was removed
 *   deactivated     none active, and an organisation has deactivated them
 *
 * A deactivated account cannot sign in at all (B1.05); `awaitingAccess` can,
 * but only reaches sign-out and the profile.
 */
export type AccessStateName = "active" | "awaitingAccess" | "deactivated";
export type AwaitingReason = "NO_MEMBERSHIP" | "INVITE_PENDING" | "REMOVED";

export interface AccessState {
  state: AccessStateName;
  awaitingAccess: boolean;
  /** Why they are waiting; null unless `state` is `awaitingAccess`. */
  reason: AwaitingReason | null;
  organizations: { id: string; slug: string; name: string; membershipId: string }[];
  pendingInvites: { organizationName: string; expiresAt: string | null; expired: boolean }[];
}

export async function getAccessState(userId: string): Promise<AccessState> {
  const memberships = await adminDb.membership.findMany({
    where: { userId },
    include: { organization: { select: { id: true, slug: true, name: true } } },
    orderBy: [{ joinedAt: "asc" }, { createdAt: "asc" }],
  });

  const active = memberships.filter((m) => m.status === "ACTIVE");
  const pending = memberships.filter((m) => m.status === "PENDING");
  const organizations = active.map((m) => ({
    id: m.organization.id,
    slug: m.organization.slug,
    name: m.organization.name,
    membershipId: m.id,
  }));
  const now = Date.now();
  const pendingInvites = pending.map((m) => ({
    organizationName: m.organization.name,
    expiresAt: m.inviteTokenExpiresAt?.toISOString() ?? null,
    expired: !m.inviteTokenExpiresAt || m.inviteTokenExpiresAt.getTime() <= now,
  }));

  if (active.length > 0) {
    return { state: "active", awaitingAccess: false, reason: null, organizations, pendingInvites };
  }
  if (memberships.some((m) => m.status === "INACTIVE")) {
    return { state: "deactivated", awaitingAccess: false, reason: null, organizations, pendingInvites };
  }
  const reason: AwaitingReason =
    pending.length > 0
      ? "INVITE_PENDING"
      : memberships.some((m) => m.status === "REMOVED")
        ? "REMOVED"
        : "NO_MEMBERSHIP";
  return { state: "awaitingAccess", awaitingAccess: true, reason, organizations, pendingInvites };
}
