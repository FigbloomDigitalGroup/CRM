import type { PlatformIdentity } from "@prisma/client";
import { RateLimitedError, UnauthorizedError, ValidationError } from "../auth/errors";
import { verifyPassword } from "../auth/password";
import { createPlatformSession, revokePlatformSession } from "../auth/platformSession";
import { loadPlatformSettings } from "../auth/platformSettings";
import { enforceRateLimit } from "../auth/rateLimiter";
import type { StoredChallenge } from "../auth/twoStep/engine";
import { platformTwoStep } from "../auth/twoStep/stores";
import { getPlatformDb } from "../db/platformClient";
import { emailSecurityAlert } from "./securityAlertService";
import { recordPlatformAudit } from "./platformAuditService";

/**
 * Real platform sign-in (FIG-1134 and FIG-1140): password, then a second step,
 * then `createPlatformSession` (FIG-1135). Two-step is ALWAYS required for a
 * platform admin: there is no organisation policy to switch off, an admin with
 * none is walked through enrolment first, and no session exists until it is
 * done. Everything runs as the platform database role: this module cannot read
 * a tenant table. Same protections as tenant sign-in: rate limits on every
 * step, a lock after repeated wrong attempts (limits are platform security
 * settings), the same generic answer for every failure, and an audit entry
 * for each outcome in the platform audit log.
 */
const GENERIC_FAILURE = "Invalid email or password.";
const GONE = "This sign-in has expired. Sign in again.";

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export interface PlatformClient {
  userAgent?: string | null;
  ipAddress?: string | null;
  place?: string | null;
}

function audit(identity: { id: string; email: string } | null, action: string, metadata: Record<string, string | number | boolean | null> = {}, targetId?: string) {
  return recordPlatformAudit(getPlatformDb(), {
    actorIdentityId: identity?.id ?? null,
    actorLabel: identity?.email ?? "anonymous",
    action,
    targetType: "PlatformIdentity",
    targetId: targetId ?? identity?.id ?? null,
    metadata,
  });
}

/** A wrong password or code: counts toward the lock (settings: attempts and minutes). Always returns the same thrown answer. */
async function registerFailure(identity: PlatformIdentity, reason: "password" | "code"): Promise<never> {
  const settings = await loadPlatformSettings();
  const failures = identity.failedSignInCount + 1;
  const locking = failures >= settings.maxFailedAttempts;
  await getPlatformDb().platformIdentity.update({
    where: { id: identity.id },
    data: {
      failedSignInCount: failures,
      lastFailedSignInAt: new Date(),
      ...(locking ? { lockedUntil: new Date(Date.now() + settings.lockoutMinutes * 60_000) } : {}),
    },
  });
  await audit(identity, locking ? "platform.signin_locked" : "platform.signin_failed", { reason, failures });
  if (locking) await emailSecurityAlert(identity.email, "too_many_failures");
  throw new UnauthorizedError(reason === "password" ? GENERIC_FAILURE : "That code is not right.");
}

function assertNotLocked(identity: PlatformIdentity): void {
  if (identity.lockedUntil && identity.lockedUntil.getTime() > Date.now()) throw new RateLimitedError();
}

export type PlatformSignInStart = { challengeToken: string; challengeExpiresAt: Date; purpose: "VERIFY" | "ENROL" };

/** Password step. Returns a challenge for the second step; never a session. */
export async function startPlatformSignIn(email: string, password: string, client: PlatformClient = {}): Promise<PlatformSignInStart> {
  const normalised = email.trim().toLowerCase();
  const windowMs = envInt("LOGIN_RATE_LIMIT_WINDOW_MS", 15 * 60_000);
  await enforceRateLimit("PLATFORM_LOGIN", [
    { scope: "ip", key: client.ipAddress ?? null, windowMs, max: envInt("PLATFORM_LOGIN_RATE_LIMIT_MAX_PER_IP", 20) },
    { scope: "email", key: normalised, windowMs, max: envInt("PLATFORM_LOGIN_RATE_LIMIT_MAX_PER_EMAIL", 8) },
  ]);

  const db = getPlatformDb();
  const identity = await db.platformIdentity.findUnique({ where: { email: normalised } });
  // The dev Super Admin has no password sign-in at all (FIG-1196); a suspended or password-less identity cannot sign in either.
  if (!identity || identity.isDev || identity.status !== "ACTIVE" || !identity.passwordHash) {
    if (identity && !identity.isDev) await audit(identity, "platform.signin_failed", { reason: identity.status !== "ACTIVE" ? "inactive" : "no_password" });
    throw new UnauthorizedError(GENERIC_FAILURE);
  }
  assertNotLocked(identity);
  if (!(await verifyPassword(password, identity.passwordHash))) return registerFailure(identity, "password");

  const engine = platformTwoStep();
  const purpose = (await engine.isEnabled(identity.id)) ? "VERIFY" : "ENROL";
  const { token, expiresAt } = await engine.issueChallenge(identity.id, purpose, client);
  if (purpose === "ENROL") await audit(identity, "platform.two_step_enrolment_required");
  return { challengeToken: token, challengeExpiresAt: expiresAt, purpose };
}

async function loadIdentityFor(challenge: StoredChallenge): Promise<PlatformIdentity> {
  const identity = await getPlatformDb().platformIdentity.findUnique({ where: { id: challenge.subjectId } });
  if (!identity || identity.status !== "ACTIVE" || identity.isDev) throw new UnauthorizedError(GONE);
  assertNotLocked(identity);
  return identity;
}

async function limitStep(identityId: string, ip: string | null, action: "TWO_STEP_VERIFY" | "TWO_STEP_ENROL") {
  const windowMs = envInt("TWO_STEP_RATE_LIMIT_WINDOW_MS", 15 * 60_000);
  await enforceRateLimit(action, [
    { scope: "platform-ip", key: ip, windowMs, max: envInt("TWO_STEP_RATE_LIMIT_MAX_PER_IP", 30) },
    { scope: "platform-user", key: identityId, windowMs, max: envInt("TWO_STEP_RATE_LIMIT_MAX_PER_USER", 10) },
  ]);
}

async function finish(identity: PlatformIdentity, challenge: StoredChallenge, method: string, client: PlatformClient) {
  const engine = platformTwoStep();
  await engine.completeChallenge(challenge);
  await getPlatformDb().platformIdentity.update({ where: { id: identity.id }, data: { failedSignInCount: 0, lockedUntil: null } });
  const session = await createPlatformSession(identity.id, client);
  await audit(identity, "platform.signed_in", { method });
  return { ...session, identityId: identity.id };
}

/** An authenticator code or a backup code. */
export async function verifyPlatformSignInCode(challengeToken: string | undefined | null, code: string, client: PlatformClient = {}) {
  const engine = platformTwoStep();
  const challenge = await engine.loadChallenge(challengeToken, "VERIFY");
  await limitStep(challenge.subjectId, client.ipAddress ?? challenge.ipAddress, "TWO_STEP_VERIFY");
  const identity = await loadIdentityFor(challenge);
  const result = await engine.verifyAnyCode(identity.id, code);
  if (!result) {
    await engine.failChallenge(challenge);
    return registerFailure(identity, "code");
  }
  if (result.method === "backup") {
    await audit(identity, "platform.backup_code_used", { remaining: result.backupCodesRemaining ?? 0 });
    await emailSecurityAlert(identity.email, "backup_code_used", { remaining: result.backupCodesRemaining ?? 0 });
  }
  return { ...(await finish(identity, challenge, result.method, { ...client, userAgent: client.userAgent ?? challenge.userAgent, ipAddress: client.ipAddress ?? challenge.ipAddress })), backupCodesRemaining: result.backupCodesRemaining ?? null };
}

export async function beginPlatformEnrolment(challengeToken: string | undefined | null, client: PlatformClient = {}) {
  const engine = platformTwoStep();
  const challenge = await engine.loadChallenge(challengeToken, "ENROL");
  await limitStep(challenge.subjectId, client.ipAddress ?? challenge.ipAddress, "TWO_STEP_ENROL");
  const identity = await loadIdentityFor(challenge);
  return engine.beginEnrolment(identity.id, identity.email);
}

/** The first code turns two-step on, shows the backup codes once and only then creates the session. */
export async function confirmPlatformEnrolment(challengeToken: string | undefined | null, code: string, client: PlatformClient = {}) {
  const engine = platformTwoStep();
  const challenge = await engine.loadChallenge(challengeToken, "ENROL");
  await limitStep(challenge.subjectId, client.ipAddress ?? challenge.ipAddress, "TWO_STEP_ENROL");
  const identity = await loadIdentityFor(challenge);
  const enrolled = await engine.confirmEnrolment(identity.id, code);
  if (!enrolled) {
    if (!(await engine.store.getCredential(identity.id))) throw new ValidationError("Start the set-up first.");
    await engine.failChallenge(challenge);
    return registerFailure(identity, "code");
  }
  await audit(identity, "platform.two_step_enrolled");
  const session = await finish(identity, challenge, "enrolment", { ...client, userAgent: client.userAgent ?? challenge.userAgent, ipAddress: client.ipAddress ?? challenge.ipAddress });
  return { ...session, backupCodes: enrolled.backupCodes };
}

export async function platformChallengeInfo(challengeToken: string | undefined | null) {
  const challenge = await platformTwoStep().loadChallenge(challengeToken);
  return { purpose: challenge.purpose, expiresAt: challenge.expiresAt.toISOString() };
}

export async function platformSignOut(token: string, identity: { id: string; email: string } | null): Promise<void> {
  await revokePlatformSession(token, "SIGNED_OUT");
  if (identity) await audit(identity, "platform.signed_out");
}
