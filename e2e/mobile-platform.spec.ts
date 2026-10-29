import { expect, test } from "@playwright/test";

/**
 * Platform mobile (PLM, FIG-1164) at 375 px, on demo data. Like platform-console.spec.ts it needs a dev server (the console exists only for the
 * dev Super Admin in development) and skips itself when the dev sign-in is closed.
 */
test.describe("Platform mobile", () => {
  test.beforeEach(async ({ request, page }) => {
    const res = await request.post("/api/dev-session", { data: { email: "dev.superadmin@platform.figbloom.local" } });
    test.skip(res.status() === 404, "The dev sign-in is closed here (production build). Run against `npm run dev` with ALLOW_DEV_ACCOUNTS=true.");
    await page.context().addCookies((await request.storageState()).cookies);
  });

  test("Home, Health and Approvals are usable at 375 px with no sideways scroll", async ({ page }) => {
    await page.goto("/platform/m");
    await expect(page.getByRole("heading", { name: "Platform home" })).toBeVisible();
    await expect(page.getByText("3 things need attention")).toBeVisible();
    for (const [tab, heading] of [["Health", "Health"], ["Approvals", "Approvals"]] as const) {
      await page.getByRole("navigation", { name: "Platform mobile" }).getByRole("link", { name: tab }).click();
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });

  test("the desktop pages hand a phone over to the mobile screens", async ({ page }) => {
    await page.goto("/platform/health");
    await page.waitForURL(/\/platform\/m\/health/);
  });
});
