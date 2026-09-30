import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { sendMembershipInviteEmail } from "../auth/email";
import { NotFoundError, ValidationError } from "../auth/errors";
import { generateInviteToken } from "../auth/membershipInvite";
import { adminDb } from "../db/adminClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  countActiveManagementMemberships,
  deactivateMembership,
  findMembershipById,
  findMembershipByOrgAndUser,
  listAllMembershipsForAdmin,
  reactivateMembership,
  setInviteToken,
  setMembershipRole,
  upsertPendingInvite,
} from "../repositories/memberships";

/**
 * Member/role administration (FIG-593). `membership.manage` covers adding,
 * deactivating, and reactivating members; `role.assign` covers changing (or
 * setting, at invite time) their role -- inviting someone requires both,
 * since it does both at once.
 */
const MANAGE = "membership.manage";
const ASSIGN_ROLE = "role.assign";
const VIEW = "membership.view";
const MANAGEMENT_ROLE_KEY = "MANAGEMENT";

async function assertNotLastActiveManagement(
  organizationId: string,
  message: string,
) {
  const count = await countActiveManagementMemberships(organizationId);
  if (count <= 1) {
    throw new ValidationError(message);
  }
}

export async function listMemberships(ctx: AuthContext) {
  requirePermission(ctx, VIEW);
  return listAllMembershipsForAdmin(ctx.organizationId);
}

export interface InviteMemberInput {
  email: string;
  name: string;
  roleKey: string;
}

/**
 * Creates the invitee's `User` row if they don't exist yet, then a PENDING
 * membership with a fresh invite token. Re-invites (regenerates the token
 * and resends) rather than erroring if a not-yet-accepted invite already
 * exists for this email -- refuses only if they're already an ACTIVE
 * member, which is a real conflict, not something to silently paper over.
 */
export async function inviteMember(
  ctx: AuthContext,
  input: InviteMemberInput,
  buildAcceptUrl: (token: string) => string,
) {
  requirePermission(ctx, MANAGE);
  requirePermission(ctx, ASSIGN_ROLE);

  const email = input.email.trim();
  const name = input.name.trim();
  if (!email || !name) {
    throw new ValidationError("Name and email are required.");
  }

  const role = await adminDb.role.findUnique({ where: { key: input.roleKey } });
  if (!role) {
    throw new ValidationError(`Unknown role "${input.roleKey}".`);
  }

  let user = await adminDb.user.findUnique({ where: { email } });
  if (!user) {
    user = await adminDb.user.create({ data: { email, name } });
  }

  const existing = await findMembershipByOrgAndUser(ctx.organizationId, user.id);
  if (existing?.status === "ACTIVE") {
    throw new ValidationError("This person is already an active member.");
  }

  const { plaintext, tokenHash, expiresAt } = generateInviteToken();
  const membership = await upsertPendingInvite({
    organizationId: ctx.organizationId,
    userId: user.id,
    roleId: role.id,
    tokenHash,
    expiresAt,
  });

  await sendMembershipInviteEmail(user.email, buildAcceptUrl(plaintext));

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: existing ? "membership.reinvited" : "membership.invited",
    entityType: "Membership",
    entityId: membership.id,
    metadata: { email: user.email, roleKey: role.key },
  });

  return { membershipId: membership.id };
}

/** Regenerates and resends the invite for a still-pending membership. */
export async function resendInvite(
  ctx: AuthContext,
  membershipId: string,
  buildAcceptUrl: (token: string) => string,
) {
  requirePermission(ctx, MANAGE);

  const membership = await findMembershipById(ctx.organizationId, membershipId);
  if (!membership) {
    throw new NotFoundError("Membership", membershipId);
  }
  if (membership.status !== "PENDING") {
    throw new ValidationError("Only a pending invite can be resent.");
  }

  const { plaintext, tokenHash, expiresAt } = generateInviteToken();
  await setInviteToken(membershipId, tokenHash, expiresAt);
  await sendMembershipInviteEmail(membership.user.email, buildAcceptUrl(plaintext));

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "membership.reinvited",
    entityType: "Membership",
    entityId: membershipId,
    metadata: { email: membership.user.email },
  });
}

export async function changeMemberRole(
  ctx: AuthContext,
  membershipId: string,
  roleKey: string,
) {
  requirePermission(ctx, ASSIGN_ROLE);

  const membership = await findMembershipById(ctx.organizationId, membershipId);
  if (!membership) {
    throw new NotFoundError("Membership", membershipId);
  }

  const role = await adminDb.role.findUnique({ where: { key: roleKey } });
  if (!role) {
    throw new ValidationError(`Unknown role "${roleKey}".`);
  }

  const movingLastManagementAway =
    membership.status === "ACTIVE" &&
    membership.role.key === MANAGEMENT_ROLE_KEY &&
    role.key !== MANAGEMENT_ROLE_KEY;
  if (movingLastManagementAway) {
    await assertNotLastActiveManagement(
      ctx.organizationId,
      "Cannot change the role of the last active Management member.",
    );
  }

  const previousRoleKey = membership.role.key;
  const updated = await setMembershipRole(membershipId, role.id);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "membership.role_changed",
    entityType: "Membership",
    entityId: membershipId,
    previousValue: { roleKey: previousRoleKey },
    newValue: { roleKey: role.key },
  });

  return updated;
}

export async function deactivateMember(ctx: AuthContext, membershipId: string) {
  requirePermission(ctx, MANAGE);

  const membership = await findMembershipById(ctx.organizationId, membershipId);
  if (!membership) {
    throw new NotFoundError("Membership", membershipId);
  }
  if (membership.status !== "ACTIVE") {
    throw new ValidationError("Only an active member can be deactivated.");
  }

  if (membership.role.key === MANAGEMENT_ROLE_KEY) {
    await assertNotLastActiveManagement(
      ctx.organizationId,
      "Cannot deactivate the last active Management member.",
    );
  }

  const updated = await deactivateMembership(membershipId);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "membership.deactivated",
    entityType: "Membership",
    entityId: membershipId,
  });

  return updated;
}

export async function reactivateMember(ctx: AuthContext, membershipId: string) {
  requirePermission(ctx, MANAGE);

  const membership = await findMembershipById(ctx.organizationId, membershipId);
  if (!membership) {
    throw new NotFoundError("Membership", membershipId);
  }
  if (membership.status !== "INACTIVE") {
    throw new ValidationError("Only an inactive member can be reactivated.");
  }
  if (!membership.joinedAt) {
    throw new ValidationError(
      "This person never accepted their invite -- resend the invite instead.",
    );
  }

  const updated = await reactivateMembership(membershipId);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "membership.reactivated",
    entityType: "Membership",
    entityId: membershipId,
  });

  return updated;
}
