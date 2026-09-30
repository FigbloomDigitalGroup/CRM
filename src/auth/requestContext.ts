import { cookies } from "next/headers";
import { adminDb } from "../db/adminClient";
import { resolveActiveMembership } from "../repositories/memberships";
import type { AuthContext } from "./context";
import {
  DEV_SESSION_COOKIE_NAME,
  verifySessionCookieValue,
} from "./devSession";
import {
  NoActiveMembershipError,
  NotFoundError,
  UnauthorizedError,
} from "./errors";
import { resolveSessionUserId, SESSION_COOKIE_NAME } from "./session";

/**
 * The minimal shape this module needs from `next/headers`'s `cookies()`.
 * Accepting this (rather than calling `cookies()` internally everywhere)
 * lets tests exercise the exact same resolution logic -- real session
 * cookie first, dev-session fallback outside production -- with a plain
 * object, since `cookies()` only works inside an actual Next.js request and
 * can't be invoked from a plain test.
 */
export interface CookieReader {
  get(name: string): { value: string } | undefined;
}

/**
 * Resolves the current request's identity: the real session cookie
 * (src/auth/session.ts) first, falling back to the dev-login placeholder
 * cookie (src/auth/devSession.ts) only outside production -- this is the
 * only place that fallback exists, so production builds never honor it
 * even if a dev cookie were somehow present.
 */
async function resolveUserId(cookieStore: CookieReader): Promise<string | null> {
  const realUserId = await resolveSessionUserId(
    cookieStore.get(SESSION_COOKIE_NAME)?.value,
  );
  if (realUserId) return realUserId;

  if (process.env.NODE_ENV === "production") return null;
  return verifySessionCookieValue(
    cookieStore.get(DEV_SESSION_COOKIE_NAME)?.value,
  );
}

/**
 * The one place every API route / server component must go through before
 * touching organization data. Resolves, in order: identity (via
 * `resolveUserId`) -> target organization (by slug from the URL, never
 * trusted as authorization by itself) -> the caller's active membership and
 * permissions in that org. Any missing step fails closed with a typed error
 * the route layer maps to a redirect or 401/403/404.
 *
 * `cookieStoreOverride` exists only for tests (see `CookieReader` above) --
 * every real caller omits it and gets the real `next/headers` cookie jar,
 * so production behavior is unchanged.
 */
export async function resolveRequestContext(
  orgSlug: string,
  cookieStoreOverride?: CookieReader,
): Promise<AuthContext> {
  const cookieStore = cookieStoreOverride ?? (await cookies());
  const userId = await resolveUserId(cookieStore);
  if (!userId) {
    throw new UnauthorizedError();
  }

  const organization = await adminDb.organization.findUnique({
    where: { slug: orgSlug },
  });
  if (!organization) {
    throw new NotFoundError("Organization", orgSlug);
  }

  const membership = await resolveActiveMembership(userId, organization.id);
  if (!membership) {
    throw new NoActiveMembershipError(orgSlug);
  }

  return membership;
}

export async function getCurrentUserId(
  cookieStoreOverride?: CookieReader,
): Promise<string | null> {
  const cookieStore = cookieStoreOverride ?? (await cookies());
  return resolveUserId(cookieStore);
}
