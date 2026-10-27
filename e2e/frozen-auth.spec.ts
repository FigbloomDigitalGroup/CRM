import { expect, test } from "@playwright/test";

/**
 * F1.07, hard rule 1: the sign-in, sign-up, forgot-password, reset-password and accept-invite pages must not change: not their markup, not
 * their styles, not their behaviour. This takes a picture of each, at desktop and phone width, and fails on any pixel that differs from the
 * recorded baseline in `e2e/frozen-auth.spec.ts-snapshots/`. (The pages have no dark variant, so there is one picture per page and width.)
 *
 * A baseline changes only when Given and Michael have approved a change to a frozen page, in the same pull request as that change.
 * Baselines are per platform (`-linux`, `-win32`); CI runs on Linux. To record them:
 *   npx playwright test e2e/frozen-auth.spec.ts --update-snapshots
 */

const PAGES: { name: string; path: string }[] = [
  { name: "login", path: "/login" },
  { name: "signup", path: "/signup" },
  { name: "forgot-password", path: "/forgot-password" },
  { name: "reset-password", path: "/reset-password?token=frozen-page-baseline" },
  { name: "accept-invite", path: "/accept-invite?token=frozen-page-baseline" },
];

const WIDTHS: { label: string; width: number; height: number }[] = [
  { label: "desktop", width: 1280, height: 800 },
  { label: "phone", width: 375, height: 812 },
];

for (const p of PAGES) {
  for (const w of WIDTHS) {
    test(`${p.name} looks exactly as approved (${w.label})`, async ({ page }) => {
      await page.setViewportSize({ width: w.width, height: w.height });
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
      await page.goto(p.path);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`${p.name}-${w.label}.png`, { fullPage: true, animations: "disabled", caret: "hide", maxDiffPixels: 0, threshold: 0 });
    });
  }
}

test("the dev sign-in chips are not on any frozen page in a production build", async ({ page }) => {
  for (const p of PAGES) {
    await page.goto(p.path);
    await expect(page.locator("[data-figbloom-dev-chips]")).toHaveCount(0);
    await expect(page.getByText("Dev sign-in")).toHaveCount(0);
  }
});
