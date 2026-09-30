import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Placeholder auth, not the real implementation. Real sessions now exist
 * (src/auth/session.ts, FIG-592) and are checked first everywhere identity
 * is resolved (src/auth/requestContext.ts) -- this remains only as a local
 * development convenience for exercising permission/ownership logic without
 * setting a password on a seeded user, and is hard-disabled outside
 * development (see src/app/dev-login/page.tsx and
 * src/app/api/dev-session/route.ts).
 *
 * A signed cookie holding a userId, picked from the FIG-438 seed's dev users
 * via /dev-login, with no password check.
 */

const COOKIE_NAME = "figbloom_dev_session";

function getSecret(): string {
  const secret = process.env.DEV_SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "DEV_SESSION_SECRET must be set (see .env.example) to use the dev-login placeholder.",
    );
  }
  return secret;
}

function sign(userId: string): string {
  return createHmac("sha256", getSecret()).update(userId).digest("base64url");
}

export function createSessionCookieValue(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

export function verifySessionCookieValue(
  value: string | undefined | null,
): string | null {
  if (!value) return null;
  const separatorIndex = value.lastIndexOf(".");
  if (separatorIndex <= 0) return null;

  const userId = value.slice(0, separatorIndex);
  const providedSignature = value.slice(separatorIndex + 1);
  const expectedSignature = sign(userId);

  const providedBuf = Buffer.from(providedSignature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(providedBuf, expectedBuf)) return null;

  return userId;
}

export { COOKIE_NAME as DEV_SESSION_COOKIE_NAME };
