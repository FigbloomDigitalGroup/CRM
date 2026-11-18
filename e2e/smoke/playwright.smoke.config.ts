import { defineConfig, devices } from "@playwright/test";

/**
 * FIG-1131 (P1.09): the production smoke suite. It runs against a deployed URL (SMOKE_BASE_URL), never starts a server, and is read-only.
 * Run with: npx playwright test -c e2e/smoke/playwright.smoke.config.ts --grep @smoke
 */
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never", outputFolder: "../../playwright-report-smoke" }]],
  use: {
    baseURL: process.env.SMOKE_BASE_URL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
});
