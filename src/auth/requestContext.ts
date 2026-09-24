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

/**
 * The one place every API route / server component must go through before
 * touching organization data (FIG-437 section 7). It resolves, in order:
 * identity (dev-session cookie, via next/headers so this works identically
 * in Server Components and Route Handlers) -> the target organization (by
 * slug, from the URL, never trusted as authorization by itself) -> the
 * caller's active membership + permissions in that organization. Any
 * missing step fails closed with a typed error the UI/route layer maps to
 * a redirect or 401/403/404.
 */
export async function resolveRequestContext(
  orgSlug: string,
): Promise<AuthContext> {
  const cookieStore = await cookies();
  const userId = verifySessionCookieValue(
    cookieStore.get(DEV_SESSION_COOKIE_NAME)?.value,
  );
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

export async function getCurrentUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  return verifySessionCookieValue(
    cookieStore.get(DEV_SESSION_COOKIE_NAME)?.value,
  );
}
