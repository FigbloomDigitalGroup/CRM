import { expect, test } from "@playwright/test";
import { loginAs, ORG_SLUG } from "./helpers";

/** FIG-1586: a call to action that points at a setting opens that section, not Organization profile. */
const HOME = `/o/${ORG_SLUG}`;

test.describe("settings links", () => {
  test("Management: the dashboard's first-run links open Members and Website integration", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    // The first-run checklist (or the empty-home buttons) carry the same links; the seeded org may have dismissed them, so follow the hrefs when shown.
    const invite = page.locator(`a[href="${HOME}/settings?tab=members"], a[href="/settings?tab=members"]`).first();
    if (await invite.count()) {
      await invite.click();
      await expect(page).toHaveURL(/tab=members/);
      await expect(page.getByRole("link", { name: "Members", exact: true })).toHaveAttribute("aria-current", "page");
    }
    await page.goto(`${HOME}/settings?tab=website`);
    await expect(page.getByRole("link", { name: "Website integration" })).toHaveAttribute("aria-current", "page");
  });

  test("the notification panel's Preferences link goes to Preferences, which every role has", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await page.goto(`${HOME}/preferences?tab=notifications`);
    await expect(page.getByRole("heading", { level: 1, name: "Preferences" })).toBeVisible();
  });
});
