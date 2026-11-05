import type { ClientInfo } from "../auth/deviceInfo";
import { AccountDeactivatedError, RateLimitedError, UnauthorizedError, ValidationError } from "../auth/errors";
import { enforceRateLimit } from "../auth/rateLimiter";
import type { StoredChallenge } from "../auth/twoStep/engine";
import { tenantTwoStep } from "../auth/twoStep/stores";
import { adminDb } from "../db/adminClient";
import { getAccessState } from "./accessStateService";
import { completeSignIn, incrementFailedSignIn, lockoutPolicy, type SignedInSession } from "./authService";
import { recordAuthAuditEvent } from "./authAudit";
import { sendSecurityAlert } from "./securityAlertService";
import { recordSignInEvent } from "./signInEventService";
import { trustThisDevice } from "./twoStepService";

/**
 * The second step of sign-in (FIG-1134, B6.02), reached through a challenge
 * the password step issued (authService.startSignIn). Nothing here creates a
 * session until the step is done. Every wrong code counts three ways: against
 * the challenge (5, then the person signs in again), against the per-IP and
 * per-account rate limits, and against the account lockout (same policy as
 * wrong passwords, B1.05).
 */
function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

async function limitStep(userId: string, ip: string | null, action: "TWO_STEP_VERIFY" | "TWO_STEP_ENROL"): Promise<void> {
  const windowMs = envInt("TWO_STEP_RATE_LIMIT_WINDOW_MS", 15 * 60_000);
  await enforceRateLimit(action, [
    { scope: "ip", key: ip, windowMs, max: envInt("TWO_STEP_RATE_LIMIT_MAX_PER_IP", 30) },
    { scope: "user", key: userId, windowMs, max: envInt("TWO_STEP_RATE_LIMIT_MAX_PER_USER", 10) },
  ]);
}

async function loadUser(challenge: StoredChallenge) {
  const user = await adminDb.user.findUnique({ where: { id: challenge.subjectId } });
  if (!user || user.status !== "ACTIVE") throw new UnauthorizedError("This sign-in has expired. Sign in again.");
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await recordSignInEvent({ userId: user.id, email: user.email, outcome: "FAILURE", reason: "LOCKED", client: clientOf(challenge) });
    throw new RateLimitedError();
  }
  return user;
}

function clientOf(challenge: StoredChallenge): ClientInfo {
  return { userAgent: challenge.userAgent, ipAddress: challenge.ipAddress, place: challenge.place };
}

/** A wrong second-step code: the challenge, and the account's lockout counter, both move. */
async function registerWrongCode(challenge: StoredChallenge, user: { id: string; email: string }): Promise<never> {
  // The challenge attempt was already counted by reserveAttempt before the code was checked.
  const policy = lockoutPolicy();
  const { failures, locking } = await incrementFailedSignIn(user.id);
  const client = clientOf(challenge);
  await recordSignInEvent({
    userId: user.id,
    email: user.email,
    outcome: locking ? "LOCKOUT" : "FAILURE",
    reason: locking ? "TOO_MANY_FAILURES" : "WRONG_TWO_STEP_CODE",
    client,
  });
  if (locking) {
    await recordAuthAuditEvent(user.id, "auth.locked_out", { failures, minutes: Math.round(policy.durationMs / 60_000), step: "two_step" });
    await sendSecurityAlert(user.id, "too_many_failures", { place: client.place ?? null });
  }
  throw new UnauthorizedError("That code is not right.");
}

async function finish(
  challenge: StoredChallenge,
  user: { id: string; email: string },
  secondStep: "totp" | "backup" | "enrolment",
  remember: boolean,
): Promise<SignedInSession & { trustedDevice: { token: string; expiresAt: Date } | null }> {
  await tenantTwoStep.completeChallenge(challenge);
  const access = await getAccessState(user.id);
  if (access.state === "deactivated") throw new AccountDeactivatedError();
  await adminDb.user.update({ where: { id: user.id }, data: { failedSignInCount: 0, lockedUntil: null } });
  const client = clientOf(challenge);
  const session = await completeSignIn(user, access, client, { secondStep });
  const trustedDevice = remember ? await trustThisDevice(user.id, client) : null;
  return { ...session, trustedDevice };
}

/** Enter an authenticator code or a backup code. */
export async function verifySignInCode(
  challengeToken: string | undefined | null,
  code: string,
  options: { remember?: boolean; ipAddress?: string | null } = {},
) {
  const challenge = await tenantTwoStep.loadChallenge(challengeToken, "VERIFY");
  await limitStep(challenge.subjectId, options.ipAddress ?? challenge.ipAddress, "TWO_STEP_VERIFY");
  const user = await loadUser(challenge);
  await tenantTwoStep.reserveAttempt(challenge);

  const result = await tenantTwoStep.verifyAnyCode(user.id, code);
  if (!result) return registerWrongCode(challenge, user);

  if (result.method === "backup") {
    await sendSecurityAlert(user.id, "backup_code_used", { remaining: result.backupCodesRemaining ?? 0, place: challenge.place });
  }
  const done = await finish(challenge, user, result.method, options.remember === true);
  return { ...done, backupCodesRemaining: result.backupCodesRemaining ?? null };
}

/** Enrolment forced by the organisation's policy: begin (gives the seed to put in the authenticator app). */
export async function beginSignInEnrolment(challengeToken: string | undefined | null, options: { ipAddress?: string | null } = {}) {
  const challenge = await tenantTwoStep.loadChallenge(challengeToken, "ENROL");
  await limitStep(challenge.subjectId, options.ipAddress ?? challenge.ipAddress, "TWO_STEP_ENROL");
  const user = await loadUser(challenge);
  return tenantTwoStep.beginEnrolment(user.id, user.email);
}

/** Enrolment forced by policy: the first code finishes it, shows the backup codes once, and only then does the session exist. */
export async function confirmSignInEnrolment(
  challengeToken: string | undefined | null,
  code: string,
  options: { remember?: boolean; ipAddress?: string | null } = {},
) {
  const challenge = await tenantTwoStep.loadChallenge(challengeToken, "ENROL");
  await limitStep(challenge.subjectId, options.ipAddress ?? challenge.ipAddress, "TWO_STEP_ENROL");
  const user = await loadUser(challenge);
  await tenantTwoStep.reserveAttempt(challenge);
  const enrolled = await tenantTwoStep.confirmEnrolment(user.id, code);
  if (!enrolled) {
    if (!(await tenantTwoStep.store.getCredential(user.id))) throw new ValidationError("Start the set-up first.");
    return registerWrongCode(challenge, user);
  }
  await recordAuthAuditEvent(user.id, "auth.two_step.enabled", { by: "enrolment_at_sign_in" });
  const done = await finish(challenge, user, "enrolment", options.remember === true);
  return { ...done, backupCodes: enrolled.backupCodes };
}
