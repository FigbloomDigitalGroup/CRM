import { expect, test } from "@playwright/test";

/**
 * FIG-1196 (B0.09): this suite runs against the production build (`next
 * build` / `next start`), where every dev sign-in must be closed: no dev
 * sign-in page, no dev sign-in API, no platform holding page, and no dev
 * account chips on /login -- even though the dev accounts exist in this
 * database (the e2e server is started with the explicit override in
 * `playwright.config.ts`).
 */
test.describe("dev accounts are closed in a production build", () => {
  test("/dev-login is a 404", async ({ page }) => {
    const res = await page.goto("/dev-login");
    expect(res?.status()).toBe(404);
  });

  test("/platform is a 404", async ({ page }) => {
    const res = await page.goto("/platform");
    expect(res?.status()).toBe(404);
  });

  test("the dev sign-in API is a 404 for the Dev Super Admin and for a tenant dev user", async ({ request }) => {
    for (const email of ["dev.superadmin@platform.figbloom.local", "dev.management@figbloom.local"]) {
      const res = await request.post("/api/dev-session", { data: { email } });
      expect(res.status()).toBe(404);
      expect(res.headers()["set-cookie"]).toBeUndefined();
    }
  });

  test("/login shows no dev account chips", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByText(/dev accounts/i)).toHaveCount(0);
    await expect(page.getByText(/Dev Super Admin/i)).toHaveCount(0);
    await expect(page.getByText(/figbloom\.local/i)).toHaveCount(0);
  });
});
