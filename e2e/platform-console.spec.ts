import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Platform console (FIG-1160 to FIG-1163) on the real API. Q2.01 (FIG-1179): rewritten on 9 Nov 2026, after M14 wired the console and hid the V2 pages
 * (support access, flags and limits, announcements). These journeys never create, suspend or delete an organisation, so they leave the database as
 * they found it; the writes are covered by tests/platform*.test.ts.
 *
 * The console is reachable only with the dev Super Admin's session, and that session works only when NODE_ENV=development with ALLOW_DEV_ACCOUNTS=true
 * (docs/PLATFORM_IDENTITY.md). The regular e2e server is a production build, where the console is a 404 (e2e/dev-accounts-closed.spec.ts checks that). So
 * these specs run against a dev server and skip themselves when the dev sign-in is closed:
 *
 *   ALLOW_DEV_ACCOUNTS=true npm run dev -- -p 3101   (then)   E2E_BASE_URL=http://localhost:3101 npx playwright test platform-console
 */
const SUPER_ADMIN = "dev.superadmin@platform.figbloom.local";

async function signInAsSuperAdmin(request: APIRequestContext, page: Page) {
  const res = await request.post("/api/dev-session", { data: { email: SUPER_ADMIN } });
  test.skip(res.status() === 404, "The dev sign-in is closed here (production build). Run against `npm run dev` with ALLOW_DEV_ACCOUNTS=true.");
  expect(res.ok()).toBeTruthy();
  const cookies = (await request.storageState()).cookies;
  await page.context().addCookies(cookies);
}

test.describe("Platform console on the real API", () => {
  test.beforeEach(async ({ request, page }) => {
    await signInAsSuperAdmin(request, page);
  });

  test("PL1: the shell is separate from the tenant app and every link stays inside it", async ({ page }) => {
    await page.goto("/platform");
    await expect(page.getByRole("heading", { name: "Platform home" })).toBeVisible();
    await expect(page.getByText("Platform admins hold no organisation role and see no customer records by default.")).toBeVisible();
    const hrefs = await page.getByRole("navigation").first().getByRole("link").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(hrefs.length).toBeGreaterThan(3);
    expect(hrefs.every((h) => h?.startsWith("/platform"))).toBe(true);
    // The V2 pages are hidden from the menu.
    for (const hidden of ["/platform/flags", "/platform/announcements", "/platform/support-access"]) expect(hrefs).not.toContain(hidden);
  });

  for (const [id, path, heading] of [
    ["PL2", "/platform/organisations", "Organisations"],
    ["PL6", "/platform/data-requests", "Data requests"],
    ["PL9", "/platform/health", "System health"],
    ["PL8", "/platform/audit", "Platform audit log"],
    ["PL10", "/platform/admins", "Platform admins"],
    ["PL11", "/platform/security", "Platform security"],
  ] as const) {
    test(`${id}: ${path} opens with its heading`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    });
  }

  test("PL3: the provisioning wizard walks to the last step and offers Create organisation (nothing is created)", async ({ page }) => {
    await page.goto("/platform/organisations/new");
    await expect(page.getByRole("heading", { name: "Provision organisation" })).toBeVisible();
    await page.getByLabel("Organisation name").fill("Kilimani Property Group QA");
    await expect(page.getByText("Available")).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel(/First admin’s name/).fill("QA Admin");
    await page.getByLabel(/First admin’s email/).fill("boss@kilimani-qa.example");
    const create = page.getByRole("button", { name: "Create organisation" });
    for (let i = 0; i < 5 && !(await create.isVisible()); i++) await page.getByRole("button", { name: "Continue" }).click();
    await expect(create).toBeVisible({ timeout: 15_000 });
  });

  test("PL4, PL5: organisation detail shows counts only, and Suspend needs a reason and the exact name", async ({ page }) => {
    await page.goto("/platform/organisations");
    await page.getByRole("link", { name: "Figbloom Sandbox" }).click();
    await expect(page.getByRole("heading", { name: "Figbloom Sandbox", level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Numbers only\. No names, values or business data\./)).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /Actions/ }).click();
    await page.getByRole("menuitem", { name: "Suspend" }).click();
    const dialog = page.getByRole("dialog");
    const confirm = dialog.getByRole("button", { name: "Suspend organisation" });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(/Reason/).fill("QA check, not submitted");
    await dialog.getByLabel(/to confirm/).fill("Figbloom Sandbox");
    await expect(confirm).toBeEnabled();
    await page.keyboard.press("Escape"); // never submit: the sandbox must stay active for the other specs
    await expect(dialog).toHaveCount(0);
  });

  test("PL15: an unknown console page shows Page not found inside the console", async ({ page }) => {
    await page.goto("/platform/nope");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("TB6: the top bar in the console names the console and the signed-in admin", async ({ page }) => {
    await page.goto("/platform");
    await expect(page.getByText(/Platform console/).first()).toBeVisible();
    await expect(page.getByRole("banner").getByRole("button").last()).toBeVisible();
  });
});

test.describe("PL14: the verify step", () => {
  test("opened without a pending sign-in it says so and signs nobody in", async ({ page }) => {
    await page.goto("/platform/verify");
    // The page first shows "Verify it’s you / One moment" while it asks the server what the pending sign-in needs, then settles. Wait for the settled state, not the loading one (asserting the loading heading raced the server's answer and failed whenever it answered fast).
    await expect(page.getByRole("heading", { name: "Sign in again" })).toBeVisible();
    await expect(page.getByText("This sign-in has expired or was never started.")).toBeVisible();
    await expect(page.getByLabel("Authenticator code")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Platform home" })).toHaveCount(0);
  });
});

test.describe("Platform console isolation", () => {
  test("without a platform session the console and its mobile pages are a 404", async ({ page }) => {
    for (const path of ["/platform", "/platform/organisations", "/platform/m", "/platform/m/approvals"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
  });
});
