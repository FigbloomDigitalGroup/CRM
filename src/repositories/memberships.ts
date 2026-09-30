import { MembershipStatus } from "@prisma/client";
import { adminDb } from "../db/adminClient";

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

export async function deactivateMembership(membershipId: string) {
  return adminDb.membership.update({
    where: { id: membershipId },
    data: { status: MembershipStatus.INACTIVE },
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

  return {
    membershipId: membership.id,
    userId: membership.userId,
    organizationId: membership.organizationId,
    roleKey: membership.role.key,
    permissionKeys: membership.role.rolePermissions.map(
      (rp) => rp.permission.key,
    ),
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

  return memberships.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    userName: m.user.name,
    userEmail: m.user.email,
    roleKey: m.role.key,
    roleName: m.role.name,
    status: m.status,
    invitedAt: m.invitedAt,
    joinedAt: m.joinedAt,
  }));
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
}) {
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
      roleId: input.roleId,
      status: MembershipStatus.PENDING,
      invitedAt: new Date(),
      inviteTokenHash: input.tokenHash,
      inviteTokenExpiresAt: input.expiresAt,
    },
    update: {
      roleId: input.roleId,
      status: MembershipStatus.PENDING,
      invitedAt: new Date(),
      inviteTokenHash: input.tokenHash,
      inviteTokenExpiresAt: input.expiresAt,
    },
  });
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
    data: { inviteTokenHash: tokenHash, inviteTokenExpiresAt: expiresAt },
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
    data: { status: MembershipStatus.ACTIVE },
  });
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
