import type { Session } from "@prisma/client";
import { cookies } from "next/headers";
import { cache } from "react";
import { adminDb } from "../db/adminClient";
import { resolveActiveMembership } from "../repositories/memberships";
import type { AuthContext } from "./context";
import {
  DEV_SESSION_COOKIE_NAME,
  verifySessionCookieValue,
} from "./devSession";
import {
  AwaitingAccessError,
  NoActiveMembershipError,
  NotFoundError,
  SessionExpiredError,
  UnauthorizedError,
} from "./errors";
import { lookupSession, SESSION_COOKIE_NAME } from "./session";

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
 * (src/auth/session.ts) first, falling back to the dev sign-in
 * cookie (src/auth/devSession.ts) only when NODE_ENV is explicitly
 * "development" (FIG-605) -- this is the only place that fallback exists,
 * so anything other than a real local dev run never honors it even if a
 * dev cookie were somehow present. Previously only disabled for
 * NODE_ENV === "production", which left it silently reachable on staging,
 * test, or any deploy that simply left NODE_ENV unset -- fail-closed by
 * default now, same reasoning as src/app/api/dev-session/route.ts.
 */
export interface Identity {
  userId: string;
  /** The server-side session behind the request; null for the dev-session fallback. */
  session: Session | null;
  sessionToken: string | null;
}

async function resolveIdentity(cookieStore: CookieReader): Promise<Identity | null> {
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const found = await lookupSession(token);
  if (found.state === "active") {
    return { userId: found.userId, session: found.session, sessionToken: token ?? null };
  }

  if (process.env.NODE_ENV === "development") {
    const devUserId = verifySessionCookieValue(
      cookieStore.get(DEV_SESSION_COOKIE_NAME)?.value,
    );
    if (devUserId) return { userId: devUserId, session: null, sessionToken: null };
  }

  // A cookie that points at an ended session is not the same as no cookie at
  // all: the caller gets the structured "session ended" 401 (B1.04) so the UI
  // can show the sign-in screen with the email already filled in.
  if (found.state === "expired" || found.state === "revoked") {
    throw new SessionExpiredError(found.state, found.email);
  }
  return null;
}

async function resolveUserId(cookieStore: CookieReader): Promise<string | null> {
  return (await resolveIdentity(cookieStore))?.userId ?? null;
}

/**
 * Identity without an organisation -- the entry point for `/api/me/*` and
 * `/api/session/*`, which belong to the person, not to one organisation.
 */
export async function resolveUserContext(
  cookieStoreOverride?: CookieReader,
): Promise<Identity> {
  const identity = cookieStoreOverride
    ? await resolveIdentity(cookieStoreOverride)
    : await resolveIdentityForRequest();
  if (!identity) throw new UnauthorizedError();
  return identity;
}

/**
 * The identity of the page request being rendered, looked up once however many server components ask (the frame and the page both do, and
 * each lookup is a database read). `cache` is scoped to one render, so nothing is shared between requests or people; outside a render (an
 * API route) it simply calls through.
 */
const resolveIdentityForRequest = cache(async (): Promise<Identity | null> => resolveIdentity(await cookies()));

/**
 * Copies the cookies of the current request into a plain object that stays readable after the response has started. `after()` callbacks
 * run once the page is on its way, when `cookies()` itself can no longer be called, so background work takes this snapshot first.
 */
export async function snapshotRequestCookies(): Promise<CookieReader> {
  const jar = new Map((await cookies()).getAll().map((c) => [c.name, c.value] as const));
  return {
    get(name) {
      const value = jar.get(name);
      return value === undefined ? undefined : { value };
    },
  };
}

/**
 * Like `resolveUserContext`, but also requires at least one active
 * membership. A signed-up user with no access yet (B1.12) can reach only
 * sign-out and their profile; every other personal endpoint uses this and is
 * refused with `AWAITING_ACCESS` until they are given a membership.
 */
export async function resolveMemberUserContext(
  cookieStoreOverride?: CookieReader,
): Promise<Identity> {
  const identity = await resolveUserContext(cookieStoreOverride);
  const active = await adminDb.membership.count({
    where: { userId: identity.userId, status: "ACTIVE" },
  });
  if (active === 0) throw new AwaitingAccessError();
  return identity;
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
  options: { allowOffboarding?: boolean } = {},
): Promise<AuthContext> {
  // The real cookie jar is resolved once per page render (the frame and the page both ask); tests with their own jar always do the full work.
  // The per-render memo is keyed by organisation only, so a call that passes `allowOffboarding` (the data-request routes, B6.05) never uses it:
  // it must not be answered from, or leave behind, a result computed for an ordinary call.
  if (cookieStoreOverride) {
    return resolveRequestContextUncached(orgSlug, () => resolveUserId(cookieStoreOverride), options);
  }
  return options.allowOffboarding
    ? resolveRequestContextUncached(orgSlug, async () => (await resolveIdentityForRequest())?.userId ?? null, options)
    : resolveRequestContextForRequest(orgSlug);
}

const resolveRequestContextForRequest = cache(async (orgSlug: string): Promise<AuthContext> =>
  resolveRequestContextUncached(orgSlug, async () => (await resolveIdentityForRequest())?.userId ?? null),
);

async function resolveRequestContextUncached(
  orgSlug: string,
  findUserId: () => Promise<string | null>,
  options: { allowOffboarding?: boolean } = {},
): Promise<AuthContext> {
  // The organisation lookup needs only the slug, so it runs while the session is being checked. Errors keep their order: no identity is
  // reported before the organisation is, exactly as before.
  const organizationLookup = adminDb.organization.findUnique({ where: { slug: orgSlug } });
  organizationLookup.catch(() => undefined);

  const userId = await findUserId();
  if (!userId) {
    throw new UnauthorizedError();
  }

  const organization = await organizationLookup;
  if (!organization) {
    throw new NotFoundError("Organization", orgSlug);
  }

  const membership = await resolveActiveMembership(userId, organization.id, options);
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
