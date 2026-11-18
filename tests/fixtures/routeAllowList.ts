/**
 * Page routes that no literal link in the source reaches, each with the reason that is fine (P2-10, FIG-1593).
 * tests/routeReachability.test.ts fails for a route that is neither linked nor listed here, and also for an entry here that is now
 * linked (so this list only ever shrinks). Keys are the route as the file system spells it, route groups removed.
 */
export const ROUTE_ALLOW_LIST: Record<string, string> = {
  "/accept-invite": "Frozen auth page, opened from the invitation email link (token in the URL), never from inside the app.",
  "/reset-password": "Frozen auth page, opened from the password-reset email link (token in the URL), never from inside the app.",
  "/dev-sentry-test": "Developer-only page for checking error reporting by typed URL; not part of the product navigation.",
};
