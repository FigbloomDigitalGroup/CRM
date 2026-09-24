import { MembershipStatus } from "@prisma/client";
import { adminDb } from "../db/adminClient";

export interface AddMembershipInput {
  organizationId: string;
  userId: string;
  roleKey: string;
}

/**
 * Adding a member to an organization is performed by an authorized
 * organization administrator or an approved management process (FIG-437
 * section 13). It runs against the admin client because it is the act of
 * *establishing* a membership, i.e. establishing the tenant boundary for
 * that user, which cannot itself depend on that membership already
 * existing.
 *
 * Cross-tenant safety here is enforced the same way ownership references
 * are enforced everywhere else: the created row's (organizationId, id) is
 * what every other org-scoped table's composite FK checks against, so a
 * membership can never silently apply to the wrong organization.
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
 * Resolves whether `userId` has an active membership in `organizationId`
 * and, if so, their role key + permission keys. This is the lookup every
 * protected request must perform before any business data is touched
 * (FIG-437 section 7) — callers must treat an undefined/inactive result as
 * "deny", never fall back to broader access.
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
