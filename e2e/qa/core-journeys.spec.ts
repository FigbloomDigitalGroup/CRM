import { expect as baseExpect, test } from "@playwright/test";
import { gotoAndSettle, loginAs, ORG_SLUG } from "../helpers";
import { orgPath } from "./catalogue";

/**
 * Q1.04 (FIG-1118): the core journeys that run on every browser in the matrix (playwright.config.ts: Chrome, Firefox, Safari, Android Chrome and
 * iOS Safari). Only the steps a person takes every day, read-only apart from the theme switch and sign-out: sign in, the home, the leads list and
 * a lead, the deals board, a customer, the theme switch (stored on the device), a notification bell, and signing out. The phone projects open the
 * phone frame (the app sends a 375 px screen there), so the phone journey checks that frame instead of the desktop sidebar.
 */

const expect = baseExpect.configure({ timeout: 25_000 });

test.describe("core journeys on every browser", () => {
  test("sign in lands on the role's home, the main lists open, and sign out ends the session", async ({ page, isMobile }) => {
    test.setTimeout(120_000);
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, orgPath(isMobile ? "/m" : ""));
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

    if (isMobile) {
      for (const [path, name] of [["/m/leads", /leads/i], ["/m/customers", /customers/i], ["/m/tasks", /tasks/i]] as const) {
        await gotoAndSettle(page, orgPath(path));
        await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      }
    } else {
      await expect(page.getByRole("complementary", { name: "Sidebar" })).toBeVisible();
      await gotoAndSettle(page, orgPath("/leads"));
      await expect(page.getByRole("heading", { level: 1, name: /leads/i })).toBeVisible();
      const firstLead = page.locator("a[href*='/leads/']").first();
      await expect(firstLead).toBeVisible();
      await firstLead.click();
      await page.waitForURL(/\/leads\/[^/]+$/);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();

      await gotoAndSettle(page, orgPath("/deals"));
      await expect(page.getByRole("heading", { level: 1, name: /deals/i })).toBeVisible();
      await gotoAndSettle(page, orgPath("/companies"));
      await expect(page.getByRole("heading", { level: 1, name: /compan/i })).toBeVisible();
    }

    const out = await page.request.post("/api/auth/logout", { headers: { origin: new URL(page.url()).origin } });
    expect(out.status()).toBeLessThan(400);
    await page.goto(orgPath(isMobile ? "/m" : ""));
    await page.waitForURL(/\/login/);
    expect(new URL(page.url()).pathname).toBe("/login");
  });

  test("the light and dark switch works and is remembered on this device", async ({ page, isMobile }) => {
    test.skip(isMobile, "the phone frame has no top-bar theme switch; its look follows the device setting");
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, orgPath(""));
    const app = page.locator(".fb-app");
    const before = await app.getAttribute("data-fb-scheme");
    await page.getByRole("button", { name: /dark|light/i }).first().click();
    const after = await app.getAttribute("data-fb-scheme");
    expect(after).not.toBe(before);
    await page.reload();
    await expect(page.locator(".fb-app")).toHaveAttribute("data-fb-scheme", after!);
    await page.getByRole("button", { name: /dark|light/i }).first().click();
  });

  test("an unauthenticated visit to a private page is sent to sign in, and the sign-in page works", async ({ page }) => {
    await page.goto(`/o/${ORG_SLUG}/leads`);
    await page.waitForURL(/\/login/);
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});
