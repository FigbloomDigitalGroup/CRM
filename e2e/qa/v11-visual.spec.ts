import { existsSync, readdirSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { loginAs } from "../helpers";
import { orgPath } from "./catalogue";
import { SUPER_ADMIN, V11_MOBILE_SCREENS, V11_PLATFORM_MOBILE, V11_PLATFORM_SCREENS, V11_SCREENS } from "./catalogue-v11";
import { applyAccountLook, applyDevice, LOOKS } from "./looks";

/**
 * Q2.02 (FIG-1180): visual baselines for the V1.1 screens in the default look, dark, one theme (Ocean) and 375 px, compared with the approved
 * baselines in `e2e/qa/v11-visual.spec.ts-snapshots/`. Same rules as e2e/qa/visual.spec.ts: baselines are per platform, volatile parts are masked, and
 * an intended change is approved by updating them in the same pull request:
 *   UPDATE_VISUAL=1 npx playwright test e2e/qa/v11-visual.spec.ts --update-snapshots
 */

const SNAPSHOTS = "e2e/qa/v11-visual.spec.ts-snapshots";
const hasBaselines = existsSync(SNAPSHOTS) && readdirSync(SNAPSHOTS).some((f) => f.endsWith(`-${process.platform}.png`));
const skipReason = `no ${process.platform} baselines recorded yet: run this spec with UPDATE_VISUAL=1 and --update-snapshots on ${process.platform}, have design approve the pictures, and commit them`;
const LOOK_NAMES = new Set(["light", "dark", "theme-ocean", "phone-375"]);
/** Live lists (chat, mail, forecast figures and so on) are held to their frame only on the phone. */
const LIVE = new Set(["chat", "mail", "forecast", "quotes", "approvals", "video", "saved-views-leads", "saved-views-deals", "m-capture"]);

async function steady(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
}

const baseMask = (page: Page) => [page.locator("time"), page.locator("[data-volatile]"), page.getByTestId(/^kpi-/), page.locator(".fb-avatar"), page.locator('[aria-label^="Notifications"]')];

for (const look of LOOKS.filter((l) => LOOK_NAMES.has(l.name))) {
  test.describe(`V1.1 look: ${look.name}`, () => {
    test("org screens match the approved baseline", async ({ browser }) => {
      test.skip(!hasBaselines && process.env.UPDATE_VISUAL !== "1", skipReason);
      test.setTimeout(400_000);
      const phone = (look.viewport?.width ?? 1280) < 500;
      const context = await browser.newContext({ viewport: look.viewport ?? { width: 1280, height: 800 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      await applyDevice(page, look.device);
      await loginAs(page, "dev.management@figbloom.local");
      const reset = await applyAccountLook(page, look);
      try {
        for (const screen of phone ? [...V11_SCREENS, ...V11_MOBILE_SCREENS] : V11_SCREENS) {
          await page.goto(orgPath(screen.path));
          await steady(page);
          await expect(page).toHaveScreenshot(`v11-${screen.name}-${look.name}.png`, {
            animations: "disabled",
            caret: "hide",
            maxDiffPixelRatio: 0.04,
            mask: [...baseMask(page), ...(LIVE.has(screen.name) && phone ? [page.locator("main")] : [])],
          });
        }
      } finally {
        await reset();
        await context.close();
      }
    });
  });
}

async function signInAsSuperAdmin(request: APIRequestContext, page: Page) {
  const res = await request.post("/api/dev-session", { data: { email: SUPER_ADMIN } });
  test.skip(res.status() === 404, "The dev sign-in is closed here (production build). Run against `npm run dev` with ALLOW_DEV_ACCOUNTS=true.");
  expect(res.ok()).toBeTruthy();
  await page.context().addCookies((await request.storageState()).cookies);
}

test.describe("V1.1 platform console visual baselines (dev Super Admin)", () => {
  for (const look of LOOKS.filter((l) => LOOK_NAMES.has(l.name))) {
    test(`console, ${look.name}`, async ({ browser, request }) => {
      test.skip(!hasBaselines && process.env.UPDATE_VISUAL !== "1", skipReason);
      test.setTimeout(300_000);
      const phone = (look.viewport?.width ?? 1280) < 500;
      const context = await browser.newContext({ viewport: look.viewport ?? { width: 1280, height: 800 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      await applyDevice(page, look.device);
      try {
        await signInAsSuperAdmin(request, page);
        // The org Appearance tab (themes) is a tenant control, so the theme look is the platform default here; the console frame is what is held.
        for (const screen of phone ? V11_PLATFORM_MOBILE : V11_PLATFORM_SCREENS) {
          await page.goto(screen.path);
          await steady(page);
          await expect(page).toHaveScreenshot(`v11-${screen.name}-${look.name}.png`, {
            animations: "disabled",
            caret: "hide",
            maxDiffPixelRatio: 0.04,
            mask: [...baseMask(page), page.locator("main")],
          });
        }
      } finally {
        await context.close();
      }
    });
  }
});
