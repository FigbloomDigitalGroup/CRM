import { defineConfig, devices } from "@playwright/test";

/**
 * FIG-602: e2e specs drive a real browser against a real running instance
 * of this app (the production build, same as `docs/DEPLOYMENT.md`'s
 * deploy sequence) talking to a real Postgres -- not a mocked DOM, for the
 * same reason the Vitest integration suite talks to real Postgres (see
 * that config's own comment): RLS/tenant isolation and the full
 * request -> auth -> service -> DB round trip are the whole point.
 *
 * Needs the app already migrated/seeded and built (`npm run db:setup` --
 * once -- then `npm run build`) before `npm run e2e`; CI does both as
 * separate steps so a migration/build failure reads as its own signal.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : "list",
  timeout: 30_000,

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    trace: "on-first-retry",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // Reuses an already-running server locally (start one with `npm run
  // dev` or `npm start` on port 3100 yourself) so repeated local runs
  // don't pay the build/start cost every time; CI always starts fresh.
  webServer: {
    command: "npm run start -- -p 3100",
    url: `${process.env.E2E_BASE_URL ?? "http://localhost:3100"}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // The production build refuses to boot while a dev account exists
    // (src/auth/devAccountGuard.ts, FIG-1196), but these specs log in as the
    // seeded dev users. This override is for this server only, and works only
    // together with ALLOW_DEV_ACCOUNTS=true; nothing else sets it.
    env: {
      E2E_ALLOW_DEV_ACCOUNTS: "true",
      ALLOW_DEV_ACCOUNTS: "true",
      // Every spec signs in through the real /login, and the suite as a whole
      // signs in far more often than the production limit (5 per email per 15
      // minutes) allows. Raised for this server only; the limiter itself is
      // covered by tests/authRateLimiting.test.ts.
      LOGIN_RATE_LIMIT_MAX_PER_EMAIL: "1000",
      LOGIN_RATE_LIMIT_MAX_PER_IP: "1000",
      // Notification emails and bell links are built from this; without it
      // they point at the default dev port and a clicked notification dead-ends.
      APP_BASE_URL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
      // `npm start` runs with NODE_ENV=production, where the storage driver
      // must be chosen explicitly (src/storage/index.ts, FIG-1023); without it
      // every page or API that shows an avatar fails. The suite uses the
      // local-disk driver (files under .data/files) with a throwaway signing
      // secret; nothing here is a real secret.
      STORAGE_DRIVER: "local",
      STORAGE_SIGNING_SECRET: "figbloom_e2e_only_storage_signing_secret",
    },
  },
});
