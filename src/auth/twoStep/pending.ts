import type { CookieReader } from "../requestContext";

/** Cookie names of the pending second step (FIG-1134). Kept here, free of next/server imports, so layouts and routes share them. */
export const PENDING_TWO_STEP_COOKIE = "figbloom_two_step_pending";
export const PENDING_PLATFORM_TWO_STEP_COOKIE = "figbloom_platform_two_step_pending";

/**
 * Where an unauthenticated visit to an organisation page goes: the new
 * /two-step route when a password-verified sign-in is waiting for its second
 * step (the frozen login page just followed `organizationSlug` into the app),
 * otherwise the sign-in page.
 */
export function unauthenticatedLanding(cookies: CookieReader): "/two-step" | "/login" {
  return cookies.get(PENDING_TWO_STEP_COOKIE)?.value ? "/two-step" : "/login";
}
