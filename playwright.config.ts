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
  },
});
