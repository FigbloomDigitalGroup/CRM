import { invalidateMeContext } from "./meContextCache";
import { withAvatars } from "./profileService";
import { requiredFeatureForRole, roleIsAvailable } from "../auth/permissions";
import { loadFeatureConfig } from "../lib/featureConfig";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { sendMembershipInviteEmail } from "../auth/email";
import {
  NotFoundError,
  RateLimitedError,
  ReassignmentRequiredError,
  ValidationError,
} from "../auth/errors";
import { generateInviteToken } from "../auth/membershipInvite";
import { revokeSessionsForUser } from "../auth/session";
import { adminDb } from "../db/adminClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  countActiveManagementMemberships,
  deactivateMembership,
  removeMembership,
  findMembershipById,
  findMembershipByOrgAndUser,
  listAllMembershipsForAdmin,
  reactivateMembership,
  setInviteToken,
  setMembershipRole,
  upsertPendingInvite,
} from "../repositories/memberships";
import { clearLoginRateLimitForEmail } from "./authService";
import { buildReassignmentChecklist } from "./reassignmentService";

/**
 * Member/role administration (FIG-593). `membership.manage` covers adding,
 * deactivating, and reactivating members; `role.assign` covers changing (or
 * setting, at invite time) their role -- inviting someone requires both,
 * since it does both at once.
 */
const MANAGE = "membership.manage";
const ASSIGN_ROLE = "role.assign";

/**
 * A flag-gated role (Customer Support, B1.01) cannot be given to anyone until
 * the organisation switches its feature on: a member holding it would carry
 * no permissions at all, which is a trap, not a role.
 */
async function assertRoleAssignable(organizationId: string, roleKey: string) {
  const feature = requiredFeatureForRole(roleKey);
  if (!feature) return;
  const config = await loadFeatureConfig(organizationId);
  if (!roleIsAvailable(roleKey, config)) {
    throw new ValidationError(
      `The ${roleKey.replace(/_/g, " ").toLowerCase()} role is not switched on for this organisation yet.`,
      [{ path: "roleKey", message: `Turn on "${feature}" first.` }],
    );
  }
}
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
  const rows = await listAllMembershipsForAdmin(ctx.organizationId);
  return withAvatars(ctx.organizationId, rows, (r) => r.userName);
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
  await assertRoleAssignable(ctx.organizationId, role.key);

  let user = await adminDb.user.findUnique({ where: { email } });
  if (!user) {
    user = await adminDb.user.create({ data: { email, name } });
  }

  const existing = await findMembershipByOrgAndUser(ctx.organizationId, user.id);
  if (existing?.status === "ACTIVE") {
    throw new ValidationError("This person is already an active member.");
  }
  if (existing?.status === "INACTIVE" && existing.joinedAt) {
    throw new ValidationError(
      "This person is deactivated -- reactivate them instead of sending a new invite.",
    );
  }

  const { plaintext, tokenHash, expiresAt } = generateInviteToken();
  const membership = await upsertPendingInvite({
    organizationId: ctx.organizationId,
    userId: user.id,
    roleId: role.id,
    tokenHash,
    expiresAt,
    invitedByMembershipId: ctx.membershipId,
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

/**
 * How soon a pending invite can be sent again. A fresh send replaces the old
 * link (the previous token stops working), so this is only a brake on mailing
 * the same person over and over.
 */
export function inviteResendCooldownMs(): number {
  const raw = Number(process.env.INVITE_RESEND_COOLDOWN_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 60_000;
}

export interface ResendInviteActor {
  membershipId?: string;
  /** For a platform operator acting outside any organisation (the platform console, later). */
  userId?: string;
}

/**
 * The resend itself, with no permission check, so the Management endpoint
 * below and the platform console (which has no membership in the customer's
 * organisation) share one set of rules: only an unaccepted invite can be
 * resent (expired ones included -- that is the point), the old link dies, the
 * new one lasts seven days, and sends are at least `inviteResendCooldownMs()`
 * apart.
 */
export async function resendAdminInvite(
  organizationId: string,
  membershipId: string,
  actor: ResendInviteActor,
  buildAcceptUrl: (token: string) => string,
) {
  const membership = await findMembershipById(organizationId, membershipId);
  if (!membership) {
    throw new NotFoundError("Membership", membershipId);
  }
  if (membership.status !== "PENDING") {
    throw new ValidationError("Only a pending invite can be resent.");
  }
  const lastSent = membership.inviteLastSentAt ?? membership.invitedAt;
  if (lastSent && Date.now() - lastSent.getTime() < inviteResendCooldownMs()) {
    throw new RateLimitedError(
      "An invite was sent a moment ago. Wait a minute before sending another.",
    );
  }

  const { plaintext, tokenHash, expiresAt } = generateInviteToken();
  await setInviteToken(membershipId, tokenHash, expiresAt);
  await sendMembershipInviteEmail(membership.user.email, buildAcceptUrl(plaintext));

  await recordAuditEvent({
    organizationId,
    actorMembershipId: actor.membershipId,
    actorUserId: actor.userId,
    action: "membership.reinvited",
    entityType: "Membership",
    entityId: membershipId,
    metadata: { email: membership.user.email },
  });
  return { membershipId, expiresAt };
}

/** Regenerates and resends the invite for a still-pending membership. */
export async function resendInvite(
  ctx: AuthContext,
  membershipId: string,
  buildAcceptUrl: (token: string) => string,
) {
  requirePermission(ctx, MANAGE);
  await resendAdminInvite(
    ctx.organizationId,
    membershipId,
    { membershipId: ctx.membershipId },
    buildAcceptUrl,
  );
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
  await assertRoleAssignable(ctx.organizationId, role.key);

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

  invalidateMeContext({ organizationId: ctx.organizationId });
  return updated;
}

/**
 * Signs a member's sessions out when they lose access to this organisation:
 * every session signed in under it, and -- when they have no other active
 * membership left -- every session they hold, since none of them can do
 * anything any more.
 */
async function endSessionsForLostAccess(
  organizationId: string,
  userId: string,
  reason: "DEACTIVATED" | "REMOVED",
): Promise<number> {
  const stillActiveElsewhere = await adminDb.membership.count({
    where: { userId, status: "ACTIVE", organizationId: { not: organizationId } },
  });
  return revokeSessionsForUser(userId, {
    reason,
    ...(stillActiveElsewhere > 0 ? { organizationId } : {}),
  });
}

/**
 * Deactivate (B1.05): sign-in is blocked (once they have no active membership
 * anywhere), their sessions end, and everything they own and have done stays
 * where it is -- greyed in lists. Returns the reassignment checklist so
 * Management can hand their open work on; deactivation itself is never
 * blocked by it.
 */
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

  const updated = await deactivateMembership(membershipId, ctx.membershipId);
  const sessionsRevoked = await endSessionsForLostAccess(
    ctx.organizationId,
    membership.userId,
    "DEACTIVATED",
  );
  const reassignment = await buildReassignmentChecklist(ctx.organizationId, membershipId);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "membership.deactivated",
    entityType: "Membership",
    entityId: membershipId,
    metadata: { sessionsRevoked, openRecords: reassignment.total },
  });

  invalidateMeContext({ organizationId: ctx.organizationId });
  return { ...updated, reassignment };
}

/**
 * Remove (B1.05): ends the membership. Blocked while the member still owns
 * open records -- the 409 carries the checklist -- so nothing is left
 * belonging to someone who is no longer there. A pending invite can be
 * removed too (it simply cancels it).
 */
export async function removeMember(ctx: AuthContext, membershipId: string) {
  requirePermission(ctx, MANAGE);

  const membership = await findMembershipById(ctx.organizationId, membershipId);
  if (!membership) {
    throw new NotFoundError("Membership", membershipId);
  }
  if (membership.status === "REMOVED") {
    throw new ValidationError("This member has already been removed.");
  }

  if (membership.status === "ACTIVE" && membership.role.key === MANAGEMENT_ROLE_KEY) {
    await assertNotLastActiveManagement(
      ctx.organizationId,
      "Cannot remove the last active Management member.",
    );
  }

  const checklist = await buildReassignmentChecklist(ctx.organizationId, membershipId);
  if (checklist.total > 0) {
    throw new ReassignmentRequiredError(checklist);
  }

  const updated = await removeMembership(membershipId, ctx.membershipId);
  const sessionsRevoked = await endSessionsForLostAccess(
    ctx.organizationId,
    membership.userId,
    "REMOVED",
  );

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "membership.removed",
    entityType: "Membership",
    entityId: membershipId,
    previousValue: { status: membership.status, roleKey: membership.role.key },
    metadata: { sessionsRevoked },
  });

  invalidateMeContext({ organizationId: ctx.organizationId });
  return updated;
}

/**
 * Admin unlock (B1.05): lifts an account lockout straight away instead of
 * waiting for it to run out, and clears the email's login window so the next
 * attempt is not turned away by the rate limiter.
 */
export async function unlockMember(ctx: AuthContext, membershipId: string) {
  requirePermission(ctx, "security.manage");

  const membership = await findMembershipById(ctx.organizationId, membershipId);
  if (!membership) {
    throw new NotFoundError("Membership", membershipId);
  }
  const wasLocked =
    !!membership.user.lockedUntil && membership.user.lockedUntil.getTime() > Date.now();

  await adminDb.user.update({
    where: { id: membership.userId },
    data: { failedSignInCount: 0, lockedUntil: null },
  });
  await clearLoginRateLimitForEmail(membership.user.email);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "auth.unlocked",
    entityType: "User",
    entityId: membership.userId,
    metadata: { by: "admin", wasLocked },
  });
  return { membershipId, unlocked: true, wasLocked };
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

  invalidateMeContext({ organizationId: ctx.organizationId });
  return updated;
}
