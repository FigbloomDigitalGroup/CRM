import { Prisma } from "@prisma/client";
import { sendPasswordResetEmail } from "../auth/email";
import { hashInviteToken } from "../auth/membershipInvite";
import {
  hashPassword,
  isPasswordStrongEnough,
  MIN_PASSWORD_LENGTH,
  verifyPassword,
} from "../auth/password";
import {
  consumePasswordResetToken,
  createPasswordResetToken,
} from "../auth/passwordResetToken";
import { enforceRateLimit, type RateLimitRule } from "../auth/rateLimiter";
import { checkLoginThrottle, clearLoginFailuresForEmail, clearLoginPair, loginThrottleConfig, recordLoginFailure } from "../auth/loginThrottle";
import {
  createSession,
  resolveSessionUserId,
  revokeAllSessionsForUser,
  revokeSession,
} from "../auth/session";
import type { ClientInfo } from "../auth/deviceInfo";
import {
  AccountDeactivatedError,
  RateLimitedError,
  UnauthorizedError,
  ValidationError,
} from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import { getAccessState, type AccessState } from "./accessStateService";
import { recordAuthAuditEvent } from "./authAudit";
import { recordSignInEvent } from "./signInEventService";
import { isTrustedDevice, revokeAllTrustedDevices, signInRequirement } from "./twoStepService";
import { tenantTwoStep } from "../auth/twoStep/stores";
import { sendSecurityAlert } from "./securityAlertService";
import {
  activateMembershipByInviteToken,
  inspectInviteToken,
} from "../repositories/memberships";

/**
 * Real authentication (FIG-592) -- the production replacement for the
 * dev sign-in placeholder (src/auth/devSession.ts). Unlike other services,
 * these functions don't take an `AuthContext`: authentication is what
 * *produces* one, so there's nothing to check permissions against yet.
 *
 * Login failures use one generic message for every cause (no such user,
 * inactive user, no password set, wrong password) -- this is a public,
 * unauthenticated, internet-reachable endpoint, so it gets the same
 * enumeration-resistant treatment as the FIG-442 website lead-capture API,
 * not the looser "existence isn't secret between colleagues" convention
 * used inside already-authenticated org-scoped services.
 */
const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password.";
const GENERIC_RESET_REQUESTED_MESSAGE =
  "If that email has an account, a password reset link has been sent.";

/**
 * Rate limiting (FIG-784) -- per IP and per email, durable across
 * instances (`src/auth/rateLimiter.ts`), checked before any real work
 * (user lookup, password hashing/verification, email send) so a caller
 * being throttled pays as little cost per rejected attempt as possible.
 * This is what actually implements "lockout": once an IP or email has hit
 * its limit, every further attempt within the window gets the exact same
 * generic `RateLimitedError` regardless of whether the credentials this
 * time happen to be correct -- same enumeration-resistant treatment as
 * `INVALID_CREDENTIALS_MESSAGE` above, just a 429 instead of a 401.
 *
 * Every limit is read live from the environment (not frozen at module
 * load) -- same reasoning as `websiteLeadService.ts`'s rate limits: ops
 * can retune without a code change, and tests can set a tiny window/limit
 * instead of firing dozens of real requests.
 */
function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Rate-limit bucket identity for an email -- normalized so `Alice@x.com` and `alice@x.com` share one counter instead of doubling the real limit. */
function normalizeEmailForRateLimit(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Sign-in limits count FAILED attempts only (D-3, 11 Nov 2026). Before, every
 * attempt counted, so an office behind one address (or one person signing in
 * repeatedly) got 429 on correct passwords. Per email: 5 failures in 15 minutes
 * (as before, in line with the account lockout). Per IP: 100 failures in 15
 * minutes, which a shared office or mobile-carrier address will not reach by
 * mistyping, but which still stops one address spraying guesses across accounts
 * (each account is further capped at 5 by the email rule).
 */
// P2-02 supersedes the old fixed limits: sign-in now uses growing waits per IP+email pair and high
// ceilings; see src/auth/loginThrottle.ts and docs/SIGN_IN_RATE_LIMIT.md.

function signupRateLimitRules(ipAddress: string | null, email: string): RateLimitRule[] {
  return [
    {
      scope: "ip",
      key: ipAddress,
      windowMs: envInt("SIGNUP_RATE_LIMIT_WINDOW_MS", 60 * 60_000),
      max: envInt("SIGNUP_RATE_LIMIT_MAX_PER_IP", 10),
    },
    {
      scope: "email",
      key: normalizeEmailForRateLimit(email),
      windowMs: envInt("SIGNUP_RATE_LIMIT_WINDOW_MS", 60 * 60_000),
      max: envInt("SIGNUP_RATE_LIMIT_MAX_PER_EMAIL", 3),
    },
  ];
}

function passwordResetRateLimitRules(
  ipAddress: string | null,
  email: string,
): RateLimitRule[] {
  return [
    {
      scope: "ip",
      key: ipAddress,
      windowMs: envInt("PASSWORD_RESET_RATE_LIMIT_WINDOW_MS", 60 * 60_000),
      max: envInt("PASSWORD_RESET_RATE_LIMIT_MAX_PER_IP", 10),
    },
    // Per IP + email pair: someone else asking for resets of your email cannot stop you asking from your own address (P2-02).
    {
      scope: "pair",
      key: `${ipAddress ?? "unknown"}|${normalizeEmailForRateLimit(email)}`,
      windowMs: envInt("PASSWORD_RESET_RATE_LIMIT_WINDOW_MS", 60 * 60_000),
      max: envInt("PASSWORD_RESET_RATE_LIMIT_MAX_PER_PAIR", 3),
    },
    // Per email across all addresses: a high ceiling that only stops mail flooding.
    {
      scope: "email",
      key: normalizeEmailForRateLimit(email),
      windowMs: envInt("PASSWORD_RESET_RATE_LIMIT_WINDOW_MS", 60 * 60_000),
      max: envInt("PASSWORD_RESET_RATE_LIMIT_MAX_PER_EMAIL", 30),
    },
  ];
}

/**
 * Account lockout (B1.05), on top of the FIG-784 rate limits above.
 *
 * Documented policy: LOCKOUT_MAX_FAILURES (default 5) wrong passwords in a row
 * lock the account for LOCKOUT_DURATION_MS (default 15 minutes). While it is
 * locked every attempt -- even with the right password -- gets the same
 * generic "too many attempts" 429 as the rate limiter, so the response never
 * says whether an account exists. Two ways out: the lock simply runs out, or
 * Management unlocks the member (`membership.manage`), which also clears the
 * email's login window. A correct sign-in resets the failure counter.
 */
export function lockoutPolicy() {
  return {
    // P2-02: raised from 5 to the per-email ceiling; reaching it now means a wait, not a lock (see accountWaitSeconds).
    maxFailures: envInt("LOCKOUT_MAX_FAILURES", 200),
    durationMs: envInt("LOCKOUT_DURATION_MS", 15 * 60_000),
  };
}

/** Forgets the email's recorded login attempts (used by the admin unlock). */
export async function clearLoginRateLimitForEmail(email: string): Promise<void> {
  await clearLoginFailuresForEmail(email);
}

function clientOf(userAgent?: string | null, ipAddress?: string | null, place?: string | null): ClientInfo {
  return { userAgent: userAgent ?? null, ipAddress: ipAddress ?? null, place: place ?? null };
}

/**
 * Creates a User and signs them straight in -- but grants no organization
 * access. FIG-437's account model treats Membership creation as an admin/
 * approved-process action (see `addMembership` in
 * `src/repositories/memberships.ts`), so signup can't shortcut that by
 * attaching a role itself; it only establishes an identity someone with
 * `configuration.manage`-equivalent access can later grant a Membership to.
 * A signed-in user with no membership sees a clear "no access yet" message
 * (the org layout's existing `NoActiveMembershipError` handling) rather than
 * anything crashing or silently granting access.
 *
 * Unlike login, revealing "that email is already registered" is normal,
 * expected signup UX, not an enumeration risk in the same sense.
 */
export async function signup(
  email: string,
  password: string,
  name: string,
  userAgent?: string | null,
  ipAddress?: string | null,
  place?: string | null,
): Promise<{ token: string; expiresAt: Date; userId: string; access: AccessState }> {
  await enforceRateLimit("SIGNUP", signupRateLimitRules(ipAddress ?? null, email));

  if (!isPasswordStrongEnough(password)) {
    throw new ValidationError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
  if (!name.trim()) {
    throw new ValidationError("Name is required.");
  }

  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = await adminDb.user.create({
      data: { email, name: name.trim(), passwordHash },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new ValidationError("An account with this email already exists.");
    }
    throw err;
  }

  const { token, expiresAt } = await createSession(user.id, {
    client: clientOf(userAgent, ipAddress, place),
  });
  return { token, expiresAt, userId: user.id, access: await getAccessState(user.id) };
}

export interface SignedInSession {
  token: string;
  expiresAt: Date;
  userId: string;
  /**
   * The organization to land on, or null if this user has no active
   * membership anywhere. Login itself is organization-agnostic (a user
   * can hold active memberships in more than one organization): the oldest
   * resolvable membership wins; the organisation switcher (B6.01) changes it afterwards.
   */
  organizationSlug: string | null;
  /** Whether the account is waiting for access to an organisation (B1.12). */
  access: AccessState;
}

/** FIG-1134 (B6.02): the password was right but a second step is still needed; no session exists yet. */
export interface TwoStepPending {
  twoStepRequired: true;
  /** VERIFY: enter a code. ENROL: the organisation requires two-step and the person has none yet. */
  purpose: "VERIFY" | "ENROL";
  challengeToken: string;
  challengeExpiresAt: Date;
  userId: string;
  organizationSlug: string | null;
  access: AccessState;
}

/**
 * The legacy single-step sign-in. Fails closed for an account that needs a
 * second step: it never returns a session for it. The login route uses
 * `startSignIn` instead.
 */
export async function login(
  email: string,
  password: string,
  userAgent?: string | null,
  ipAddress?: string | null,
  place?: string | null,
): Promise<SignedInSession> {
  const result = await startSignIn(email, password, userAgent, ipAddress, place);
  if ("twoStepRequired" in result) {
    throw new UnauthorizedError("Two-step verification is required to sign in to this account.");
  }
  return result;
}

/**
 * Password step of sign-in. Returns a session, or (FIG-1134) a pending
 * two-step challenge when the account has two-step on, or its organisation
 * requires it. A trusted device skips the code, never the enrolment.
 */
export async function startSignIn(
  email: string,
  password: string,
  userAgent?: string | null,
  ipAddress?: string | null,
  place?: string | null,
  trustedDeviceToken?: string | null,
): Promise<SignedInSession | TwoStepPending> {
  const ip = ipAddress ?? null;
  // A live trusted-device cookie of this very account skips every wait (P2-02): the real person on their own device is never held up.
  const trusted = await isKnownTrustedDevice(email, trustedDeviceToken);
  // Checked before any real work; failures only are recorded (below), so successful sign-ins never count.
  await checkLoginThrottle(ip, email, { trusted });
  try {
    const result = await signInChecked(email, password, userAgent, ipAddress, place, trustedDeviceToken, trusted);
    await clearLoginPair(ip, email);
    return result;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      const reached = await recordLoginFailure(ip, email);
      if (reached.emailCeilingReached) {
        const user = await adminDb.user.findUnique({ where: { email }, select: { id: true } });
        if (user) await recordAuthAuditEvent(user.id, "auth.rate_limit_ceiling", { scope: "email", failures: loginThrottleConfig().maxPerEmail });
      }
    }
    throw err;
  }
}

async function isKnownTrustedDevice(email: string, token?: string | null): Promise<boolean> {
  if (!token) return false;
  const user = await adminDb.user.findUnique({ where: { email }, select: { id: true } });
  return user ? isTrustedDevice(user.id, token) : false;
}

/**
 * Seconds a person must still wait because the account reached its failure ceiling
 * (`lockedUntil`). It is a wait, not a lock: the longest sign-in delay counted from the
 * last failure, after which the right password signs in. Anyone typing wrong passwords for
 * someone's email can therefore never keep that person out (P2-02).
 */
export function accountWaitSeconds(user: { lockedUntil: Date | null; lastFailedSignInAt: Date | null }, now = Date.now()): number {
  if (!user.lockedUntil || user.lockedUntil.getTime() <= now || !user.lastFailedSignInAt) return 0;
  const seconds = loginThrottleConfig().maxSeconds;
  return Math.max(0, Math.ceil((user.lastFailedSignInAt.getTime() + seconds * 1000 - now) / 1000));
}

async function signInChecked(
  email: string,
  password: string,
  userAgent?: string | null,
  ipAddress?: string | null,
  place?: string | null,
  trustedDeviceToken?: string | null,
  trusted = false,
): Promise<SignedInSession | TwoStepPending> {
  const client = clientOf(userAgent, ipAddress, place);
  const user = await adminDb.user.findUnique({ where: { email } });

  if (!user || user.status !== "ACTIVE" || !user.passwordHash) {
    // An unknown email has no organisation to attribute the attempt to, so
    // nothing is logged for it; a known but unusable account is.
    if (user) {
      await recordSignInEvent({
        userId: user.id,
        email: user.email,
        outcome: "FAILURE",
        reason: user.status !== "ACTIVE" ? "ACCOUNT_INACTIVE" : "NO_PASSWORD",
        client,
      });
    }
    throw new UnauthorizedError(INVALID_CREDENTIALS_MESSAGE);
  }

  const policy = lockoutPolicy();
  const now = Date.now();
  if (user.lockedUntil) {
    const wait = trusted ? 0 : accountWaitSeconds(user, now);
    if (wait > 0) {
      await recordSignInEvent({
        userId: user.id,
        email: user.email,
        outcome: "FAILURE",
        reason: "LOCKED",
        client,
      });
      throw new RateLimitedError(`Too many sign-in attempts. Please wait ${wait} second${wait === 1 ? "" : "s"} and try again.`, wait);
    }
    if (user.lockedUntil.getTime() <= now) {
      // The lock window has run out: time-based unlock.
      await adminDb.user.update({
        where: { id: user.id },
        data: { lockedUntil: null, failedSignInCount: 0 },
      });
      user.failedSignInCount = 0;
      await recordAuthAuditEvent(user.id, "auth.unlocked", { by: "timeout" });
    }
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    const { failures, locking } = await incrementFailedSignIn(user.id);
    if (locking) {
      await recordSignInEvent({
        userId: user.id,
        email: user.email,
        outcome: "LOCKOUT",
        reason: "TOO_MANY_FAILURES",
        client,
      });
      await recordAuthAuditEvent(user.id, "auth.locked_out", {
        failures,
        minutes: Math.round(policy.durationMs / 60_000),
      });
    } else {
      await recordSignInEvent({
        userId: user.id,
        email: user.email,
        outcome: "FAILURE",
        reason: "WRONG_PASSWORD",
        client,
      });
    }
    throw new UnauthorizedError(INVALID_CREDENTIALS_MESSAGE);
  }

  // The password proved who is asking, so it is safe to say why they are
  // refused: every organisation they belonged to has deactivated them.
  const access = await getAccessState(user.id);
  if (access.state === "deactivated") {
    await recordSignInEvent({
      userId: user.id,
      email: user.email,
      outcome: "FAILURE",
      reason: "DEACTIVATED",
      client,
    });
    throw new AccountDeactivatedError();
  }

  const requirement = await signInRequirement(user.id, trustedDeviceToken);
  // The counter is reset only once every step is done: with a second step still
  // owed (here, or in twoStepSignInService.finish) wrong codes keep accumulating.
  if (requirement === "NONE" && (user.failedSignInCount > 0 || user.lockedUntil)) {
    await adminDb.user.update({
      where: { id: user.id },
      data: { failedSignInCount: 0, lockedUntil: null },
    });
  }
  if (requirement !== "NONE") {
    const { token, expiresAt } = await tenantTwoStep.issueChallenge(user.id, requirement, client);
    if (requirement === "ENROL") await recordAuthAuditEvent(user.id, "auth.two_step.enrolment_forced");
    return {
      twoStepRequired: true,
      purpose: requirement,
      challengeToken: token,
      challengeExpiresAt: expiresAt,
      userId: user.id,
      organizationSlug: access.organizations[0]?.slug ?? null,
      access,
    };
  }

  return completeSignIn(user, access, client);
}

/**
 * Counts one failed attempt (wrong password or wrong second-step code) atomically:
 * the database increments the counter, so parallel guesses cannot overwrite each
 * other, and the lock is set from the value the database returned.
 */
export async function incrementFailedSignIn(userId: string): Promise<{ failures: number; locking: boolean }> {
  const policy = lockoutPolicy();
  const now = Date.now();
  const row = await adminDb.user.update({
    where: { id: userId },
    data: { failedSignInCount: { increment: 1 }, lastFailedSignInAt: new Date(now) },
    select: { failedSignInCount: true },
  });
  const failures = row.failedSignInCount;
  const locking = failures >= policy.maxFailures;
  if (locking) {
    await adminDb.user.update({ where: { id: userId }, data: { lockedUntil: new Date(now + policy.durationMs) } });
  }
  return { failures, locking };
}

/**
 * Issues the session and records the sign-in. Called once every required step
 * is done: straight after the password, or after the second step (FIG-1134).
 */
export async function completeSignIn(
  user: { id: string; email: string },
  access: AccessState,
  client: ClientInfo,
  opts: { secondStep?: "totp" | "backup" | "enrolment" | "trusted_device" } = {},
): Promise<SignedInSession> {
  const session = await createSession(user.id, { client });
  await recordSignInEvent({
    userId: user.id,
    email: user.email,
    outcome: "SUCCESS",
    sessionId: session.sessionId,
    deviceLabel: session.deviceLabel,
    client,
  });
  if (session.isNewDevice) {
    await recordSignInEvent({
      userId: user.id,
      email: user.email,
      outcome: "NEW_DEVICE",
      sessionId: session.sessionId,
      deviceLabel: session.deviceLabel,
      client,
    });
    // An account with two-step on is told about a device it has not signed in from before.
    if (await tenantTwoStep.isEnabled(user.id)) {
      await sendSecurityAlert(user.id, "new_device", { device: session.deviceLabel, place: client.place ?? null });
    }
  }
  await recordAuthAuditEvent(user.id, "auth.login", opts.secondStep ? { secondStep: opts.secondStep } : undefined);

  const organizationSlug = access.organizations[0]?.slug ?? null;
  return {
    token: session.token,
    expiresAt: session.expiresAt,
    userId: user.id,
    organizationSlug,
    access,
  };
}

export async function logout(token: string): Promise<void> {
  const userId = await resolveSessionUserId(token);
  await revokeSession(token, "SIGNED_OUT");
  if (userId) {
    await recordAuthAuditEvent(userId, "auth.logout");
  }
}

/**
 * Always returns the same generic result whether or not the email matches a
 * user -- same enumeration-resistance reasoning as login. Only actually
 * creates and sends a token when a matching, active user exists.
 */
export async function requestPasswordReset(
  email: string,
  buildResetUrl: (token: string) => string,
  ipAddress?: string | null,
): Promise<{ message: string }> {
  await enforceRateLimit(
    "PASSWORD_RESET",
    passwordResetRateLimitRules(ipAddress ?? null, email),
  );

  const user = await adminDb.user.findUnique({ where: { email } });

  if (user && user.status === "ACTIVE") {
    const { token } = await createPasswordResetToken(user.id);
    await sendPasswordResetEmail(user.email, buildResetUrl(token));
  }

  return { message: GENERIC_RESET_REQUESTED_MESSAGE };
}

/**
 * Consumes the token, sets the new password, and revokes every existing
 * session for the account -- a password reset should not leave an earlier,
 * possibly-compromised session still valid.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<void> {
  if (!isPasswordStrongEnough(newPassword)) {
    throw new ValidationError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }

  const userId = await consumePasswordResetToken(token);
  if (!userId) {
    throw new ValidationError("Invalid or expired reset link.");
  }

  const passwordHash = await hashPassword(newPassword);
  await adminDb.user.update({ where: { id: userId }, data: { passwordHash } });
  await revokeAllSessionsForUser(userId, "PASSWORD_RESET");
  // A trusted device skips the second step: a reset must not leave one valid.
  await revokeAllTrustedDevices(userId);
  await recordAuthAuditEvent(userId, "auth.password_reset");
}

const INVALID_INVITE_MESSAGE = "Invalid or expired invite link.";
const EXPIRED_INVITE_MESSAGE =
  "This invite has expired. Ask your organisation's Management users to send a new one.";

/** The invite behind a token, or a clear refusal: expired (ask for a new one) versus unknown or already used. */
async function requireUsableInvite(tokenHash: string) {
  const found = await inspectInviteToken(tokenHash);
  if (found.state === "expired") {
    throw new ValidationError(EXPIRED_INVITE_MESSAGE, [
      { path: "token", message: EXPIRED_INVITE_MESSAGE },
    ]);
  }
  if (found.state === "unknown") {
    throw new ValidationError(INVALID_INVITE_MESSAGE);
  }
  return found.membership;
}

/**
 * Read-only lookup for the /accept-invite page (FIG-593) -- does not
 * consume the token, so the page can decide whether to show a password
 * field (a brand-new invitee has no password yet) without spending the
 * single-use token just by loading the page.
 */
export async function getInviteInfo(
  token: string,
): Promise<{ email: string; requiresPassword: boolean }> {
  const membership = await requireUsableInvite(hashInviteToken(token));
  return {
    email: membership.user.email,
    requiresPassword: !membership.user.passwordHash,
  };
}

/**
 * Consumes the invite token, activates the membership, sets a password if
 * the invitee didn't have one yet, and signs them straight in. An existing
 * user (already has a password) accepting a second org's invite doesn't
 * need or use `password` at all.
 */
export async function acceptMembershipInvite(
  token: string,
  password: string | undefined,
  userAgent?: string | null,
  ipAddress?: string | null,
  place?: string | null,
  trustedDeviceToken?: string | null,
): Promise<
  | {
      token: string;
      expiresAt: Date;
      userId: string;
      organizationSlug: string;
    }
  | {
      twoStepRequired: true;
      purpose: "VERIFY" | "ENROL";
      challengeToken: string;
      challengeExpiresAt: Date;
      userId: string;
      organizationSlug: string;
    }
> {
  const tokenHash = hashInviteToken(token);

  // Validate the password *before* consuming the single-use token -- doing
  // it after would leave the membership activated but the account
  // permanently unreachable (no password, and the now-burned link can't be
  // retried) if validation failed.
  const preview = await requireUsableInvite(tokenHash);
  if (!preview.user.passwordHash) {
    if (!password || !isPasswordStrongEnough(password)) {
      throw new ValidationError(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
    }
  }

  const activated = await activateMembershipByInviteToken(tokenHash);
  if (!activated) {
    throw new ValidationError("Invalid or expired invite link.");
  }
  const { membership, user } = activated;

  if (!user.passwordHash) {
    // `password` was already validated above against this same branch.
    const passwordHash = await hashPassword(password as string);
    await adminDb.user.update({ where: { id: user.id }, data: { passwordHash } });
  }

  await recordAuditEvent({
    organizationId: membership.organizationId,
    actorMembershipId: membership.id,
    actorUserId: user.id,
    action: "membership.invite_accepted",
    entityType: "Membership",
    entityId: membership.id,
  });

  const client = clientOf(userAgent, ipAddress, place);

  // The link proves the mailbox, not the second factor: apply the same decision as
  // password sign-in (own two-step, or the organisation's policy) before any session.
  const requirement = await signInRequirement(user.id, trustedDeviceToken);
  if (requirement !== "NONE") {
    const challenge = await tenantTwoStep.issueChallenge(user.id, requirement, client);
    if (requirement === "ENROL") await recordAuthAuditEvent(user.id, "auth.two_step.enrolment_forced");
    const org = await adminDb.organization.findUniqueOrThrow({
      where: { id: membership.organizationId },
      select: { slug: true },
    });
    return {
      twoStepRequired: true,
      purpose: requirement,
      challengeToken: challenge.token,
      challengeExpiresAt: challenge.expiresAt,
      userId: user.id,
      organizationSlug: org.slug,
    };
  }

  const {
    token: sessionToken,
    expiresAt,
    sessionId,
    deviceLabel,
  } = await createSession(user.id, { client, organizationId: membership.organizationId });
  await recordSignInEvent({
    userId: user.id,
    email: user.email,
    outcome: "SUCCESS",
    reason: "INVITE_ACCEPTED",
    sessionId,
    deviceLabel,
    client,
    organizationId: membership.organizationId,
  });
  const organization = await adminDb.organization.findUniqueOrThrow({
    where: { id: membership.organizationId },
    select: { slug: true },
  });
  return {
    token: sessionToken,
    expiresAt,
    userId: user.id,
    organizationSlug: organization.slug,
  };
}
