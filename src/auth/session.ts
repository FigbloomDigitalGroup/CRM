import { randomBytes, createHash } from "node:crypto";
import { adminDb } from "../db/adminClient";

/**
 * Real, revocable, server-tracked sessions (FIG-592) -- the production
 * replacement for src/auth/devSession.ts's stateless signed cookie.
 *
 * Same generate-random/hash-and-compare pattern as WebsiteApiKey
 * (src/auth/websiteApiKey.ts): the token is high-entropy (32 random bytes),
 * so a fast hash (SHA-256) is the right tool, and only the hash is ever
 * persisted. Being DB-backed (rather than a signed JWT) is what makes
 * "sessions ... can be revoked" possible -- revocation just has to update a
 * row, not wait out a token's lifetime or maintain a denylist.
 */

const COOKIE_NAME = "figbloom_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function generateToken(): { plaintext: string; tokenHash: string } {
  const plaintext = randomBytes(32).toString("base64url");
  return { plaintext, tokenHash: hashToken(plaintext) };
}

export async function createSession(
  userId: string,
  userAgent?: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const { plaintext, tokenHash } = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await adminDb.session.create({
    data: { userId, tokenHash, expiresAt, userAgent: userAgent ?? undefined },
  });

  return { token: plaintext, expiresAt };
}

/**
 * Resolves a session cookie to its user id, rejecting anything expired or
 * revoked. Touches `lastSeenAt` on every successful resolution so a "log out
 * everywhere" / stale-session view has something meaningful to show later,
 * without extending `expiresAt` -- a session's absolute lifetime is fixed at
 * creation, it does not silently renew forever from continued use.
 */
export async function resolveSessionUserId(
  token: string | undefined | null,
): Promise<string | null> {
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = await adminDb.session.findUnique({ where: { tokenHash } });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;

  await adminDb.session.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() },
  });

  return session.userId;
}

export async function revokeSession(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await adminDb.session.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Used by password reset -- a new password should kill every other session. */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await adminDb.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export { COOKIE_NAME as SESSION_COOKIE_NAME };
