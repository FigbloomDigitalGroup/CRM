/**
 * Shared local-dev password for every @figbloom.local seed fixture
 * (prisma/devSeed.ts, scripts/manual-add-second-sales-user.ts) -- not a
 * secret, just a convenience so every seeded account works the same way
 * through the real /login flow. Centralized here so the places that need it
 * (the seed scripts, and /login's quick-login dropdown) can't drift out of
 * sync with each other.
 */
export const DEV_FIXTURE_PASSWORD = "figbloom-dev-local";

/** Every dev tenant user's email ends with this; a real user can never use it. */
export const DEV_EMAIL_SUFFIX = "@figbloom.local";

export function isDevAccountEmail(email: string): boolean {
  return email.toLowerCase().endsWith(DEV_EMAIL_SUFFIX);
}

type Env = Record<string, string | undefined>;

/**
 * Whether dev accounts may be signed in to through the dev sign-in routes
 * (FIG-1196, B0.09; CLAUDE.md rule 10). Fail-closed on both counts: the
 * environment must be explicitly "development" (not merely "not production",
 * FIG-605) AND `ALLOW_DEV_ACCOUNTS` must be exactly "true". Every dev-only
 * route, page and chip goes through this one function.
 */
export function devAccountsAllowed(env: Env = process.env): boolean {
  return env.NODE_ENV === "development" && env.ALLOW_DEV_ACCOUNTS === "true";
}
