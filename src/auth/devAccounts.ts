/**
 * Shared local-dev password for every @figbloom.local seed fixture
 * (prisma/seed.ts, scripts/manual-add-second-sales-user.ts) -- not a
 * secret, just a convenience so every seeded account works the same way
 * through the real /login flow. Centralized here so the three places that
 * need it (the two seed scripts, and /login's quick-login dropdown) can't
 * drift out of sync with each other.
 */
export const DEV_FIXTURE_PASSWORD = "figbloom-dev-local";
