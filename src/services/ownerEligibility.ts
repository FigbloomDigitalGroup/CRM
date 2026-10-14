import { ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";

/**
 * Whoever receives a record has to be able to actually work it: see it and
 * edit it. Finance, Delivery and Restricted Technical hold neither for
 * leads, so a lead handed to them would vanish from every screen they can
 * open. These checks keep every owner picker and every server-side
 * assignment honest about that.
 */
export function canWorkLeads(permissionKeys: string[]): boolean {
  const has = (k: string) => permissionKeys.includes(k);
  return (
    (has("leads.view.all") || has("leads.view.own")) &&
    (has("leads.edit.all") || has("leads.edit.own"))
  );
}

export function canWorkDeals(permissionKeys: string[]): boolean {
  const has = (k: string) => permissionKeys.includes(k);
  return (
    (has("deals.view.all") || has("deals.view.own")) &&
    (has("deals.edit.all") || has("deals.edit.own"))
  );
}

export async function loadActiveMemberWithPermissions(
  organizationId: string,
  membershipId: string,
) {
  if (typeof membershipId !== "string" || membershipId.length === 0) {
    throw new ValidationError("An owner is required.");
  }
  const membership = await adminDb.membership.findFirst({
    where: { id: membershipId, organizationId, status: "ACTIVE" },
    include: {
      role: { include: { rolePermissions: { include: { permission: true } } } },
    },
  });
  if (!membership) {
    throw new ValidationError(
      "The target owner must be an active member of this organization.",
    );
  }
  return {
    id: membership.id,
    roleName: membership.role.name,
    permissionKeys: membership.role.rolePermissions.map(
      (rp) => rp.permission.key,
    ),
  };
}

export async function assertEligibleLeadOwner(
  organizationId: string,
  membershipId: string,
) {
  const member = await loadActiveMemberWithPermissions(
    organizationId,
    membershipId,
  );
  if (!canWorkLeads(member.permissionKeys)) {
    throw new ValidationError(
      `A ${member.roleName} user cannot own leads -- pick someone whose role can view and edit leads.`,
    );
  }
  return member;
}

export async function assertEligibleDealOwner(
  organizationId: string,
  membershipId: string,
) {
  const member = await loadActiveMemberWithPermissions(
    organizationId,
    membershipId,
  );
  if (!canWorkDeals(member.permissionKeys)) {
    throw new ValidationError(
      `A ${member.roleName} user cannot own deals -- pick someone whose role can view and edit deals.`,
    );
  }
  return member;
}

/** Active members who can own a deal -- feeds the deal owner pickers. */
export async function listDealOwnerCandidates(organizationId: string) {
  const memberships = await adminDb.membership.findMany({
    where: { organizationId, status: "ACTIVE" },
    include: {
      user: true,
      role: { include: { rolePermissions: { include: { permission: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  return memberships
    .filter((m) =>
      canWorkDeals(m.role.rolePermissions.map((rp) => rp.permission.key)),
    )
    .map((m) => ({
      membershipId: m.id,
      userName: m.user.name,
      roleName: m.role.name,
    }));
}
