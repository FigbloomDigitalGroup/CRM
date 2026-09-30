import { Prisma } from "@prisma/client";
import { sendPasswordResetEmail } from "../auth/email";
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
import {
  createSession,
  resolveSessionUserId,
  revokeAllSessionsForUser,
  revokeSession,
} from "../auth/session";
import { UnauthorizedError, ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { recordAuditEvent } from "../repositories/auditEvents";

/**
 * Real authentication (FIG-592) -- the production replacement for the
 * dev-login placeholder (src/auth/devSession.ts). Unlike other services,
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

async function recordAuthAuditEvent(
  userId: string,
  action: "auth.login" | "auth.logout" | "auth.password_reset",
) {
  const memberships = await adminDb.membership.findMany({
    where: { userId },
    select: { id: true, organizationId: true },
  });
  await Promise.all(
    memberships.map((m) =>
      recordAuditEvent({
        organizationId: m.organizationId,
        actorMembershipId: m.id,
        actorUserId: userId,
        action,
        entityType: "User",
        entityId: userId,
      }),
    ),
  );
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
): Promise<{ token: string; expiresAt: Date; userId: string }> {
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

  const { token, expiresAt } = await createSession(user.id, userAgent);
  return { token, expiresAt, userId: user.id };
}

export async function login(
  email: string,
  password: string,
  userAgent?: string | null,
): Promise<{ token: string; expiresAt: Date; userId: string }> {
  const user = await adminDb.user.findUnique({ where: { email } });

  if (!user || user.status !== "ACTIVE" || !user.passwordHash) {
    throw new UnauthorizedError(INVALID_CREDENTIALS_MESSAGE);
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError(INVALID_CREDENTIALS_MESSAGE);
  }

  const { token, expiresAt } = await createSession(user.id, userAgent);
  await recordAuthAuditEvent(user.id, "auth.login");

  return { token, expiresAt, userId: user.id };
}

export async function logout(token: string): Promise<void> {
  const userId = await resolveSessionUserId(token);
  await revokeSession(token);
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
): Promise<{ message: string }> {
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
  await revokeAllSessionsForUser(userId);
  await recordAuthAuditEvent(userId, "auth.password_reset");
}
