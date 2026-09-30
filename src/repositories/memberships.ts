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
