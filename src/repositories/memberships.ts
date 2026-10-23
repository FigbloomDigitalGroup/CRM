import { MembershipStatus } from "@prisma/client";
import { effectivePermissionKeys } from "../auth/permissions";
import { adminDb } from "../db/adminClient";
import { loadFeatureConfig } from "../lib/featureConfig";

export interface AddMembershipInput {
  organizationId: string;
  userId: string;
  roleKey: string;
}

/**
 * Runs against the admin client, not `withOrgContext` -- this call
 * establishes the tenant boundary for the user, so it can't depend on a
 * membership already existing. Requires an org admin or approved process
 * to call it (FIG-437).
 *
 * Cross-tenant safety comes from the same place as everywhere else: every
 * org-scoped table's composite FK checks against this row's
 * (organizationId, id), so a membership can't silently apply to the wrong org.
 */
export async function addMembership(input: AddMembershipInput) {
  const role = await adminDb.role.findUniqueOrThrow({
    where: { key: input.roleKey },
  });

  return adminDb.membership.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      roleId: role.id,
      status: MembershipStatus.ACTIVE,
      joinedAt: new Date(),
    },
  });
}

export async function deactivateMembership(
  membershipId: string,
  actorMembershipId?: string,
) {
  return adminDb.membership.update({
    where: { id: membershipId },
    data: {
      status: MembershipStatus.INACTIVE,
      deactivatedAt: new Date(),
      deactivatedByMembershipId: actorMembershipId ?? null,
    },
  });
}

/** Ends a membership (B1.05). The row stays, so history keeps pointing at a real member. */
export async function removeMembership(
  membershipId: string,
  actorMembershipId?: string,
) {
  return adminDb.membership.update({
    where: { id: membershipId },
    data: {
      status: MembershipStatus.REMOVED,
      removedAt: new Date(),
      removedByMembershipId: actorMembershipId ?? null,
      inviteTokenHash: null,
      inviteTokenExpiresAt: null,
    },
  });
}

/**
 * Resolves whether `userId` has an active membership in `organizationId`,
 * and their role/permission keys if so. Every protected request must check
 * this before touching business data (FIG-437) -- treat a null result as
 * deny, never fall back to broader access.
 */
export async function resolveActiveMembership(
  userId: string,
  organizationId: string,
) {
  const membership = await adminDb.membership.findFirst({
    where: { userId, organizationId, status: MembershipStatus.ACTIVE },
    include: {
      role: { include: { rolePermissions: { include: { permission: true } } } },
    },
  });

  if (!membership) {
    return null;
  }

  // B1.01/B1.03: the keys a request carries are the role's catalogue keys
  // adjusted for this organization's release, departure flags and (for
  // Customer Support) role flag.
  const config = await loadFeatureConfig(organizationId);
  return {
    membershipId: membership.id,
    userId: membership.userId,
    organizationId: membership.organizationId,
    roleKey: membership.role.key,
    permissionKeys: effectivePermissionKeys({
      roleKey: membership.role.key,
      catalogueKeys: membership.role.rolePermissions.map((rp) => rp.permission.key),
      config,
    }),
  };
}

export type ActiveMembership = NonNullable<
  Awaited<ReturnType<typeof resolveActiveMembership>>
>;

/** Active members of an organization, for assignment/ownership pickers. */
export async function listOrganizationMemberships(organizationId: string) {
  const memberships = await adminDb.membership.findMany({
    where: { organizationId, status: MembershipStatus.ACTIVE },
    include: { user: true, role: true },
    orderBy: { createdAt: "asc" },
  });

  return memberships.map((m) => ({
    membershipId: m.id,
    userName: m.user.name,
    userEmail: m.user.email,
    roleKey: m.role.key,
    roleName: m.role.name,
  }));
}

/**
 * Every membership regardless of status, for the member-administration
 * table (FIG-593) -- unlike `listOrganizationMemberships`, above, this is
 * for admins managing the roster itself, so pending invites and
 * deactivated members need to show up too, not just active ones.
 */
export async function listAllMembershipsForAdmin(organizationId: string) {
  const memberships = await adminDb.membership.findMany({
    where: { organizationId },
    include: { user: true, role: true },
    orderBy: { createdAt: "asc" },
  });

  const names = new Map(memberships.map((m) => [m.id, m.user.name]));
  const actor = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  const now = Date.now();

  return memberships.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    userName: m.user.name,
    userEmail: m.user.email,
    roleKey: m.role.key,
    roleName: m.role.name,
    status: m.status,
    /** B1.12: the four states the Settings screen shows. */
    state: membershipState(m.status),
    invitedAt: m.invitedAt,
    joinedAt: m.joinedAt,
    inviteExpiresAt: m.status === "PENDING" ? m.inviteTokenExpiresAt : null,
    inviteExpired:
      m.status === "PENDING" &&
      (!m.inviteTokenExpiresAt || m.inviteTokenExpiresAt.getTime() <= now),
    inviteLastSentAt: m.inviteLastSentAt,
    invitedByName: actor(m.invitedByMembershipId),
    deactivatedAt: m.deactivatedAt,
    deactivatedByName: actor(m.deactivatedByMembershipId),
    removedAt: m.removedAt,
    removedByName: actor(m.removedByMembershipId),
    /** B1.05: set while the account is locked after repeated failed sign-ins. */
    lockedUntil: m.user.lockedUntil && m.user.lockedUntil.getTime() > now ? m.user.lockedUntil : null,
  }));
}

export type MembershipState = "invited" | "active" | "deactivated" | "removed";

/** The API's name for a membership's status. */
export function membershipState(status: MembershipStatus): MembershipState {
  switch (status) {
    case "PENDING":
      return "invited";
    case "ACTIVE":
      return "active";
    case "INACTIVE":
      return "deactivated";
    case "REMOVED":
      return "removed";
  }
}

/** A single membership, tenant-scoped -- the lookup every mutation below starts from. */
export async function findMembershipById(
  organizationId: string,
  membershipId: string,
) {
  return adminDb.membership.findFirst({
    where: { id: membershipId, organizationId },
    include: { user: true, role: true },
  });
}

/** Whether this user already has a membership row (any status) in this org. */
export async function findMembershipByOrgAndUser(
  organizationId: string,
  userId: string,
) {
  return adminDb.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: { user: true, role: true },
  });
}

/**
 * Creates a new PENDING membership, or re-invites an existing one that was
 * never accepted (PENDING, or INACTIVE with no `joinedAt`) -- see
 * `membershipService.ts#inviteMember` for the full decision. Never touches
 * an ACTIVE membership; the service checks that before calling this.
 */
export async function upsertPendingInvite(input: {
  organizationId: string;
  userId: string;
  roleId: string;
  tokenHash: string;
  expiresAt: Date;
  invitedByMembershipId?: string;
}) {
  const now = new Date();
  // A re-invite starts the membership's story over: whoever removed or
  // deactivated them earlier no longer describes its current state.
  const fresh = {
    roleId: input.roleId,
    status: MembershipStatus.PENDING,
    invitedAt: now,
    inviteLastSentAt: now,
    invitedByMembershipId: input.invitedByMembershipId ?? null,
    inviteTokenHash: input.tokenHash,
    inviteTokenExpiresAt: input.expiresAt,
    deactivatedAt: null,
    deactivatedByMembershipId: null,
    removedAt: null,
    removedByMembershipId: null,
  };
  return adminDb.membership.upsert({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    },
    create: {
      organizationId: input.organizationId,
      userId: input.userId,
      ...fresh,
    },
    update: fresh,
  });
}

/**
 * Like `findMembershipByInviteToken`, but tells an expired invite apart from
 * one that does not exist (B1.12) -- the holder of a real token is entitled
 * to know it ran out and to ask for a new one. A used token is cleared from
 * the row on acceptance, so it reads as unknown, not expired.
 */
export async function inspectInviteToken(tokenHash: string) {
  const membership = await adminDb.membership.findUnique({
    where: { inviteTokenHash: tokenHash },
    include: { user: true },
  });
  if (!membership || membership.status !== MembershipStatus.PENDING) {
    return { state: "unknown" as const, membership: null };
  }
  if (
    !membership.inviteTokenExpiresAt ||
    membership.inviteTokenExpiresAt.getTime() <= Date.now()
  ) {
    return { state: "expired" as const, membership };
  }
  return { state: "valid" as const, membership };
}

/** Read-only lookup for the accept-invite page -- does not consume the token. */
export async function findMembershipByInviteToken(tokenHash: string) {
  const membership = await adminDb.membership.findUnique({
    where: { inviteTokenHash: tokenHash },
    include: { user: true },
  });

  if (
    !membership ||
    membership.status !== MembershipStatus.PENDING ||
    !membership.inviteTokenExpiresAt ||
    membership.inviteTokenExpiresAt.getTime() <= Date.now()
  ) {
    return null;
  }

  return membership;
}

/**
 * Validates and consumes an invite token in one step: activates the
 * membership and clears the token so it can never be replayed. Returns
 * null for anything invalid/expired/already-used, same fail-closed
 * contract as `resolveActiveMembership`.
 */
export async function activateMembershipByInviteToken(tokenHash: string) {
  const membership = await findMembershipByInviteToken(tokenHash);
  if (!membership) {
    return null;
  }

  const updated = await adminDb.membership.update({
    where: { id: membership.id },
    data: {
      status: MembershipStatus.ACTIVE,
      joinedAt: new Date(),
      inviteTokenHash: null,
      inviteTokenExpiresAt: null,
    },
  });

  return { membership: updated, user: membership.user };
}

export async function setInviteToken(
  membershipId: string,
  tokenHash: string,
  expiresAt: Date,
) {
  return adminDb.membership.update({
    where: { id: membershipId },
    data: {
      inviteTokenHash: tokenHash,
      inviteTokenExpiresAt: expiresAt,
      inviteLastSentAt: new Date(),
    },
  });
}

export async function setMembershipRole(membershipId: string, roleId: string) {
  return adminDb.membership.update({
    where: { id: membershipId },
    data: { roleId },
  });
}

export async function reactivateMembership(membershipId: string) {
  return adminDb.membership.update({
    where: { id: membershipId },
    data: {
      status: MembershipStatus.ACTIVE,
      deactivatedAt: null,
      deactivatedByMembershipId: null,
    },
  });
}

/**
 * Every organization this user currently has an ACTIVE membership in,
 * oldest first -- used right after login (FIG-604) to pick which
 * organization to land on. A user can legitimately belong to more than
 * one organization; this app has no organization-switcher UI yet, so for
 * now the caller lands on the oldest one it can resolve, not a choice.
 */
export async function listActiveOrganizationSlugsForUser(
  userId: string,
): Promise<string[]> {
  const memberships = await adminDb.membership.findMany({
    where: { userId, status: MembershipStatus.ACTIVE },
    include: { organization: true },
    orderBy: { joinedAt: "asc" },
  });
  return memberships.map((m) => m.organization.slug);
}

/** For the "cannot remove the last Management user" guard (FIG-593). */
export async function countActiveManagementMemberships(
  organizationId: string,
) {
  return adminDb.membership.count({
    where: {
      organizationId,
      status: MembershipStatus.ACTIVE,
      role: { key: "MANAGEMENT" },
    },
  });
}
