import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * THIS IS NOT THE FIG-437 AUTHENTICATION IMPLEMENTATION.
 *
 * FIG-437 section 18 explicitly leaves "exact authentication provider" and
 * "exact session/token strategy" as open decisions for a future ticket
 * (real login, password/SSO, provider choice — NextAuth, Clerk, Supabase
 * Auth, or a bespoke implementation). FIG-439 needs *some* way to identify
 * "the current user" so its permission/ownership logic (leads.view.own,
 * leads.assign, etc.) can be exercised end-to-end through real HTTP
 * requests and UI screens.
 *
 * This module is the smallest thing that unblocks that: a signed cookie
 * containing a userId, chosen from the FIG-438 seed's dev users via
 * /dev-login, with no password check at all. It must be replaced wholesale
 * — not extended — when real authentication is implemented; nothing
 * downstream (services, API routes) depends on its internals, only on the
 * `userId: string | null` it produces.
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
