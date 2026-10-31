import { existsSync, readdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "../helpers";
import { orgPath } from "./catalogue";
import { applyAccountLook, applyDevice, LOOKS } from "./looks";

/**
 * Q1.03 (FIG-1117): the visual regression suite. A picture of the key V1 screens in every look (light, dark, three themes, compact, Largest text,
 * high contrast, 375 px), compared with the approved baseline in `e2e/qa/visual.spec.ts-snapshots/`. The frozen sign-in pages have their own
 * zero-pixel suite (`e2e/frozen-auth.spec.ts`) and a source guard against the `pre-makeover` tag (`tests/frozenAuthSource.test.ts`).
 *
 * Baselines are per platform (`-win32`, `-linux`); CI runs on Linux and a diff fails the build, so an intended change is approved by updating the
 * baseline in the same pull request, which design reviews:
 *   UPDATE_VISUAL=1 npx playwright test e2e/qa/visual.spec.ts --update-snapshots
 * The component gallery is the stable subject (fixed data, no dates); the real screens are shot with the volatile parts (dates, counts, names
 * that depend on when the seed ran) masked.
 */

const SCREENS = [
  { name: "home", path: "" },
  { name: "leads", path: "/leads" },
  { name: "deals", path: "/deals" },
  { name: "companies", path: "/companies" },
  { name: "preferences", path: "/preferences?tab=appearance" },
  { name: "reports", path: "/reports" },
];

/** Baselines are per platform. Until the Linux ones are recorded and approved (see above), the suite cannot judge a Linux run, so it says so and skips there. */
const SNAPSHOTS = "e2e/qa/visual.spec.ts-snapshots";
const hasBaselines = existsSync(SNAPSHOTS) && readdirSync(SNAPSHOTS).some((f) => f.endsWith(`-${process.platform}.png`));
const skipReason = `no ${process.platform} baselines recorded yet: run this spec with UPDATE_VISUAL=1 and --update-snapshots on ${process.platform}, have design approve the pictures, and commit them`;

async function steady(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
}

for (const look of LOOKS) {
  test.describe(`look: ${look.name}`, () => {
    test(`key screens match the approved baseline`, async ({ browser }) => {
      test.skip(!hasBaselines && process.env.UPDATE_VISUAL !== "1", skipReason);
      test.setTimeout(240_000);
      const context = await browser.newContext({ viewport: look.viewport ?? { width: 1280, height: 800 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      await applyDevice(page, look.device);
      await loginAs(page, "dev.sales@figbloom.local");
      const reset = await applyAccountLook(page, look);
      try {
        for (const screen of SCREENS) {
          await page.goto(orgPath(screen.path));
          await steady(page);
          await expect(page).toHaveScreenshot(`${screen.name}-${look.name}.png`, {
            animations: "disabled",
            caret: "hide",
            maxDiffPixelRatio: 0.04,
            // The phone Today screen is a live list of the person's tasks and counts (and a greeting that follows the clock), so only its frame (header,
            // tab bar, spacing) is held by the baseline there; the desktop home keeps its content and masks only the figures.
            mask: [page.locator("time"), page.locator("[data-volatile]"), page.getByTestId(/^kpi-/), page.locator(".fb-avatar"), page.locator('[aria-label^="Notifications"]'), ...(screen.name === "home" && (look.viewport?.width ?? 1280) < 500 ? [page.locator("main")] : [])],
          });
        }
      } finally {
        await reset();
        await context.close();
      }
    });
  });
}
