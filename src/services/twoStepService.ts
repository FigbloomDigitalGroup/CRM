import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { describeDevice } from "../auth/deviceInfo";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "../auth/errors";
import { verifyPassword } from "../auth/password";
import { enforceRateLimit } from "../auth/rateLimiter";
import { revokeSessionsForUser } from "../auth/session";
import { hashToken, newToken } from "../auth/twoStep/secretBox";
import { tenantTwoStep } from "../auth/twoStep/stores";
import { adminDb } from "../db/adminClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import { recordAuthAuditEvent } from "./authAudit";
import { sendSecurityAlert } from "./securityAlertService";

/**
 * Two-step sign-in for organisation users (FIG-1134, B6.02): policy, the
 * decision at sign-in, enrolment, backup codes, trusted devices and recovery.
 * The sign-in steps that issue a session live in twoStepSignInService.ts.
 * Platform admins use the same engine through platformTwoStepService.ts.
 */
export const TWO_STEP_POLICY_KEY = "security.require_two_step";
export const TRUSTED_DEVICE_COOKIE_NAME = "figbloom_trusted_device";
export const TRUSTED_DEVICE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Rate limits for the sensitive checks a signed-in person makes (disable, new backup codes, enrol). Read live so tests can shrink them. */
export async function limitSensitiveCheck(userId: string, ip: string | null): Promise<void> {
  const windowMs = envInt("TWO_STEP_RATE_LIMIT_WINDOW_MS", 15 * 60_000);
  await enforceRateLimit("TWO_STEP_VERIFY", [
    { scope: "user", key: userId, windowMs, max: envInt("TWO_STEP_RATE_LIMIT_MAX_PER_USER", 10) },
    { scope: "ip", key: ip, windowMs, max: envInt("TWO_STEP_RATE_LIMIT_MAX_PER_IP", 30) },
  ]);
}

// ---- organisation policy ----

/** The organisations (among the person's active memberships) that require two-step. */
export async function organisationsRequiringTwoStep(userId: string): Promise<string[]> {
  const memberships = await adminDb.membership.findMany({ where: { userId, status: "ACTIVE" }, select: { organizationId: true } });
  if (memberships.length === 0) return [];
  const settings = await adminDb.organizationSetting.findMany({
    where: { key: TWO_STEP_POLICY_KEY, organizationId: { in: memberships.map((m) => m.organizationId) } },
  });
  return settings.filter((s) => s.value === true).map((s) => s.organizationId);
}

export async function getTwoStepPolicy(ctx: AuthContext): Promise<{ required: boolean; trustedDeviceDays: number; yourTwoStepIsOn: boolean }> {
  requirePermission(ctx, "security.manage");
  const row = await adminDb.organizationSetting.findUnique({
    where: { organizationId_key: { organizationId: ctx.organizationId, key: TWO_STEP_POLICY_KEY } },
  });
  return { required: row?.value === true, trustedDeviceDays: TRUSTED_DEVICE_DAYS, yourTwoStepIsOn: await tenantTwoStep.isEnabled(ctx.userId) };
}

/**
 * Management requires (or stops requiring) two-step for the organisation. Turning it on
 * needs the actor's own two-step to be on (they would lock themselves out otherwise) and signs
 * out every other member who has not set it up, so no session outlives the policy without
 * verification; they meet the enrolment step at their next sign-in.
 */
export async function setTwoStepPolicy(ctx: AuthContext, required: boolean): Promise<{ required: boolean; signedOut: number }> {
  requirePermission(ctx, "security.manage");
  const previous = (await getTwoStepPolicy(ctx)).required;
  if (required && !(await tenantTwoStep.isEnabled(ctx.userId))) {
    throw new ValidationError("Set up your own two-step sign-in before requiring it for the organisation.");
  }
  await adminDb.organizationSetting.upsert({
    where: { organizationId_key: { organizationId: ctx.organizationId, key: TWO_STEP_POLICY_KEY } },
    create: { organizationId: ctx.organizationId, key: TWO_STEP_POLICY_KEY, value: required },
    update: { value: required },
  });

  let signedOut = 0;
  if (required) {
    const members = await adminDb.membership.findMany({ where: { organizationId: ctx.organizationId, status: "ACTIVE" }, select: { userId: true } });
    for (const { userId } of members) {
      if (userId === ctx.userId) continue;
      if (await tenantTwoStep.isEnabled(userId)) continue;
      signedOut += await revokeSessionsForUser(userId, { reason: "TWO_STEP_REQUIRED", organizationId: ctx.organizationId });
    }
  }
  if (previous !== required) {
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "security.two_step_policy_changed",
      entityType: "Organization",
      entityId: ctx.organizationId,
      previousValue: { required: previous },
      newValue: { required },
      metadata: { sessionsEnded: signedOut },
    });
  }
  return { required, signedOut };
}

// ---- the decision at sign-in ----

export type SignInRequirement = "NONE" | "VERIFY" | "ENROL";

/** What a password-verified sign-in must still do. A valid trusted device skips the code, never the enrolment. */
export async function signInRequirement(userId: string, trustedDeviceToken?: string | null): Promise<SignInRequirement> {
  if (await tenantTwoStep.isEnabled(userId)) {
    return (await isTrustedDevice(userId, trustedDeviceToken)) ? "NONE" : "VERIFY";
  }
  return (await organisationsRequiringTwoStep(userId)).length > 0 ? "ENROL" : "NONE";
}

// ---- own settings ----

export async function getMyTwoStep(userId: string) {
  const status = await tenantTwoStep.status(userId);
  return {
    ...status,
    requiredByOrganisation: (await organisationsRequiringTwoStep(userId)).length > 0,
    trustedDevices: await listTrustedDevices(userId),
  };
}

export async function beginMyEnrolment(userId: string, ip: string | null) {
  await limitSensitiveCheck(userId, ip);
  const user = await adminDb.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) throw new NotFoundError("User", userId);
  return tenantTwoStep.beginEnrolment(userId, user.email);
}

export async function confirmMyEnrolment(userId: string, code: string, ip: string | null) {
  await limitSensitiveCheck(userId, ip);
  const done = await tenantTwoStep.confirmEnrolment(userId, code);
  if (!done) throw new ValidationError("That code is not right. Check your authenticator app and try again.", [{ path: "code", message: "Wrong code." }]);
  await recordAuthAuditEvent(userId, "auth.two_step.enabled", { by: "self" });
  return done;
}

/** Proves the person with their password and a current code (or backup code) before a sensitive change. */
async function verifyPasswordAndCode(userId: string, password: string, code: string, ip: string | null): Promise<void> {
  await limitSensitiveCheck(userId, ip);
  const user = await adminDb.user.findUnique({ where: { id: userId } });
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) throw new UnauthorizedError("Password or code is not right.");
  if (!(await tenantTwoStep.verifyAnyCode(userId, code))) throw new UnauthorizedError("Password or code is not right.");
}

export async function disableMyTwoStep(userId: string, password: string, code: string, ip: string | null): Promise<void> {
  if ((await organisationsRequiringTwoStep(userId)).length > 0) {
    throw new ForbiddenError("two_step.required_by_organisation");
  }
  await verifyPasswordAndCode(userId, password, code, ip);
  await tenantTwoStep.disable(userId);
  await adminDb.userTrustedDevice.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await sendSecurityAlert(userId, "two_step_disabled");
}

export async function regenerateMyBackupCodes(userId: string, password: string, code: string, ip: string | null): Promise<string[]> {
  await verifyPasswordAndCode(userId, password, code, ip);
  const codes = await tenantTwoStep.regenerateBackupCodes(userId);
  await sendSecurityAlert(userId, "backup_codes_regenerated");
  return codes;
}

// ---- trusted devices ----

export interface TrustedDeviceSummary {
  id: string;
  label: string | null;
  addedAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

export async function listTrustedDevices(userId: string): Promise<TrustedDeviceSummary[]> {
  const rows = await adminDb.userTrustedDevice.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: "desc" },
  });
  return rows.map((r) => ({ id: r.id, label: r.label, addedAt: r.createdAt.toISOString(), lastUsedAt: r.lastUsedAt.toISOString(), expiresAt: r.expiresAt.toISOString() }));
}

export async function trustThisDevice(userId: string, client: { userAgent?: string | null; ipAddress?: string | null }): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_DAYS * DAY_MS);
  const label = describeDevice(client.userAgent);
  await adminDb.userTrustedDevice.create({ data: { userId, tokenHash: hashToken(token), label, ipAddress: client.ipAddress ?? null, expiresAt } });
  await sendSecurityAlert(userId, "trusted_device_added", { device: label });
  return { token, expiresAt };
}

/** True for a live, unrevoked trusted device of this person. Touches its last-used time. */
export async function isTrustedDevice(userId: string, token?: string | null): Promise<boolean> {
  if (!token) return false;
  const row = await adminDb.userTrustedDevice.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.userId !== userId || row.revokedAt || row.expiresAt.getTime() <= Date.now()) return false;
  await adminDb.userTrustedDevice.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  return true;
}

export async function revokeTrustedDevice(userId: string, id: string): Promise<void> {
  const r = await adminDb.userTrustedDevice.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (r.count === 0) throw new NotFoundError("Trusted device", id);
  await recordAuthAuditEvent(userId, "auth.two_step.trusted_device_revoked", { id });
}

export async function revokeAllTrustedDevices(userId: string): Promise<number> {
  const r = await adminDb.userTrustedDevice.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return r.count;
}

// ---- recovery by an administrator ----

/**
 * Management resets a member's two-step (lost phone and no backup codes). The seed, backup codes and
 * trusted devices are removed, every session of the person ends, and the person is told by email;
 * at the next sign-in they enrol again (and must, where the organisation requires it). Allowed
 * only for members who belong to no other organisation: resetting would weaken their security in
 * organisations this admin has no say over. Audited in the organisation's history.
 */
export async function adminResetMemberTwoStep(ctx: AuthContext, membershipId: string): Promise<{ reset: true }> {
  requirePermission(ctx, "membership.manage");
  const target = await adminDb.membership.findFirst({ where: { id: membershipId, organizationId: ctx.organizationId } });
  if (!target) throw new NotFoundError("Membership", membershipId);
  if (target.userId === ctx.userId) throw new ValidationError("Use your own security settings to change your two-step sign-in.");
  const others = await adminDb.membership.count({ where: { userId: target.userId, organizationId: { not: ctx.organizationId }, status: { in: ["ACTIVE", "INACTIVE", "PENDING"] } } });
  if (others > 0) {
    throw new ForbiddenError("two_step.reset_member_of_other_organisations", { roleKey: ctx.roleKey, organizationId: ctx.organizationId });
  }
  await tenantTwoStep.disable(target.userId);
  await revokeAllTrustedDevices(target.userId);
  await revokeSessionsForUser(target.userId, { reason: "TWO_STEP_RESET" });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "security.two_step_reset",
    entityType: "Membership",
    entityId: membershipId,
    metadata: { targetUserId: target.userId },
  });
  await sendSecurityAlert(target.userId, "two_step_reset_by_admin");
  return { reset: true };
}
