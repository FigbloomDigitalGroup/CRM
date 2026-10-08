import { expect, test } from "@playwright/test";
import { DEV_PASSWORD, ORG_SLUG } from "./helpers";

test.describe("login", () => {
  test("logs in with a real seeded account through the real auth flow", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("dev.management@figbloom.local");
    await page.locator('input[type="password"]').fill(DEV_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(new RegExp(`/o/${ORG_SLUG}`));
    // exact: true -- the dashboard's own "Leads" stat-card link also
    // points at the same URL, with a longer accessible name ("Leads 1
    // visible organization-wide"), which would otherwise make this an
    // ambiguous (strict-mode-violating) match against the sidebar link.
    await expect(page.getByRole("link", { name: "Leads", exact: true })).toBeVisible();
  });

  test("rejects a wrong password and stays on the login page", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("dev.management@figbloom.local");
    await page.locator('input[type="password"]').fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText(/invalid|incorrect|failed/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
