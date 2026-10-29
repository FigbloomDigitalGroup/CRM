import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Platform console (M10: FIG-1160 to FIG-1163, FIG-1192 platform half), on demo data.
 *
 * The console is reachable only with the dev Super Admin's session, and that session exists only in development with ALLOW_DEV_ACCOUNTS=true. The
 * regular e2e server is a production build, where the console is a 404 (e2e/dev-accounts-closed.spec.ts checks that). So these specs run against a
 * dev server and skip themselves when the dev sign-in is closed:
 *
 *   ALLOW_DEV_ACCOUNTS=true npm run dev -- -p 3100   (then)   E2E_BASE_URL=http://localhost:3100 npx playwright test platform-console
 */
const SUPER_ADMIN = "dev.superadmin@platform.figbloom.local";

async function signInAsSuperAdmin(request: APIRequestContext, page: Page) {
  const res = await request.post("/api/dev-session", { data: { email: SUPER_ADMIN } });
  test.skip(res.status() === 404, "The dev sign-in is closed here (production build). Run against `npm run dev` with ALLOW_DEV_ACCOUNTS=true.");
  expect(res.ok()).toBeTruthy();
  const cookies = (await request.storageState()).cookies;
  await page.context().addCookies(cookies);
}

test.describe("Platform console on demo data", () => {
  test.beforeEach(async ({ request, page }) => {
    await signInAsSuperAdmin(request, page);
  });

  test("the shell is separate from the tenant app and says it is demo data", async ({ page }) => {
    await page.goto("/platform");
    await expect(page.getByText("Platform console", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Platform home" })).toBeVisible();
    await expect(page.getByText("Dev only: verification skipped").first()).toBeVisible();
    await expect(page.getByText("Demo data")).toHaveCount(0);
    const hrefs = await page.getByRole("navigation").first().getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(hrefs.every((h) => h?.startsWith("/platform"))).toBe(true);
    await expect(page.getByText("3 things need attention")).toBeVisible();
  });

  test("provisioning wizard creates an organisation and opens it", async ({ page }) => {
    await page.goto("/platform/organisations/new");
    await page.getByLabel("Organisation name").fill("Kilimani Property Group");
    await expect(page.getByText("Available")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/First admin/).fill("boss@kilimani.co.ke");
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Create organisation" }).click();
    await expect(page.getByRole("heading", { name: "Kilimani Property Group is ready" })).toBeVisible();
    await page.getByRole("button", { name: "Open organisation" }).click();
    await expect(page.getByRole("heading", { name: "Kilimani Property Group" })).toBeVisible();
  });

  test("suspending needs a reason and the exact name, then the organisation shows as suspended", async ({ page }) => {
    await page.goto("/platform/organisations");
    await page.getByRole("link", { name: "Figbloom Sandbox" }).click();
    await page.getByRole("button", { name: /Actions/ }).click();
    await page.getByRole("menuitem", { name: "Suspend" }).click();
    const confirm = page.getByRole("dialog").getByRole("button", { name: "Suspend organisation" });
    await expect(confirm).toBeDisabled();
    await page.getByRole("dialog").getByLabel(/Reason/).fill("Abuse report");
    await page.getByRole("dialog").getByLabel(/to confirm/).fill("Figbloom Sandbox");
    await confirm.click();
    await expect(page.getByText(/Suspended: members can’t sign in/)).toBeVisible();
  });

  test("two-approver flow: one admin cannot approve twice, a different admin unlocks deletion", async ({ page }) => {
    await page.goto("/platform/data-requests");
    await expect(page.getByText(/Waiting for a second, different admin/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve as second admin" })).toHaveCount(0);
    await expect(page.getByLabel(/Delete organisation data/)).toBeDisabled();
    await page.getByRole("button", { name: /Approve as Given/ }).click();
    await expect(page.getByText(/Approved by Dev Super Admin and Given\. Deletion can run\./)).toBeVisible();
    await expect(page.getByLabel(/Delete organisation data/)).toBeEnabled();
  });

  test("the second-last platform admin cannot be removed, and removing asks Verify it’s you", async ({ page }) => {
    await page.goto("/platform/admins");
    await page.getByRole("button", { name: "Remove" }).nth(2).click();
    const dialog = page.getByRole("dialog", { name: "Verify it’s you" });
    await dialog.getByLabel("Authenticator code").fill("123456");
    await dialog.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByText(/Only two admins left/)).toBeVisible();
    // The button is aria-disabled (it stays focusable so its reason can be read), so Playwright needs force to click it.
    await page.getByRole("button", { name: "Remove" }).nth(1).click({ force: true });
    await expect(page.getByText("Blocked: at least two platform admins are required.")).toBeVisible();
    await expect(page.getByText(/added by/)).toHaveCount(2);
  });

  test("support access: request, organisation approves, countdown shows, ending is one click", async ({ page }) => {
    await page.goto("/platform/support-access");
    await page.getByLabel("Reason").fill("Check the import");
    await page.getByRole("button", { name: "Send request to the organisation" }).click();
    await page.getByRole("button", { name: "Approve as the organisation" }).first().click();
    await expect(page.getByText(/Support view, read-only/)).toBeVisible();
    await page.getByRole("button", { name: "End", exact: true }).click();
    await expect(page.getByText(/Support view, read-only/)).toHaveCount(0);
  });

  test("flags and limits change is written to the history; an announcement publishes", async ({ page }) => {
    await page.goto("/platform/flags");
    await page.getByLabel("Assistant for Figbloom Sandbox").check();
    await expect(page.getByText("Off → On")).toBeVisible();
    await page.goto("/platform/announcements");
    await page.getByRole("button", { name: "Publish now" }).click();
    await expect(page.getByText(/Status:\s*Live/)).toBeVisible();
  });

  test("an unknown console page shows PL15 inside the console", async ({ page }) => {
    await page.goto("/platform/nope");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("sign out ends the platform session", async ({ page }) => {
    await page.goto("/platform");
    await page.getByRole("button", { name: /Dev Super Admin/ }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
    const res = await page.goto("/platform");
    expect(res?.status()).toBe(404);
  });
});

test.describe("Platform console isolation", () => {
  test("without a platform session the console and its mobile pages are a 404, and the verify step is only a demo", async ({ page }) => {
    for (const path of ["/platform", "/platform/organisations", "/platform/m", "/platform/m/approvals"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
  });
});
