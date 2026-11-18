import { readFileSync } from "node:fs";
import { expect as baseExpect, test, type APIRequestContext, type Page } from "@playwright/test";
import { loginAs } from "../helpers";
import { orgPath } from "./catalogue";
import { SUPER_ADMIN, V11_MOBILE_SCREENS, V11_PLATFORM_MOBILE, V11_PLATFORM_SCREENS, V11_SCREENS, V11_TOP_LEVEL } from "./catalogue-v11";
import { applyAccountLook, applyDevice, LOOKS } from "./looks";

/**
 * Q2.02 (FIG-1180): the automated accessibility pass for the V1.1 screens, built like e2e/qa/a11y-sweep.spec.ts. axe (WCAG 2.0, 2.1, 2.2, A and AA)
 * runs on every V1.1 org screen in the default look, and on a core set in dark, one theme and 375 px. Zero serious or critical violations is the bar;
 * moderate and minor ones are attached to the report. The platform console runs in its own describe and skips when the dev Super Admin sign-in is closed.
 */

const expect = baseExpect.configure({ timeout: 20_000 });
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const LOOK_NAMES = new Set(["dark", "theme-ocean", "phone-375"]);
const CORE = new Set(["quotes", "approvals", "forecast", "chat", "mail", "settings-catalogue", "help", "preferences-colours"]);

interface Found {
  id: string;
  impact: string | null | undefined;
  help: string;
  nodes: string[];
}

async function scan(page: Page): Promise<Found[]> {
  await page.evaluate(axeSource);
  return page.evaluate(async (tags) => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; impact: string; help: string; nodes: { target: unknown[] }[] }[] }> } }).axe;
    const result = await axe.run(document, { runOnly: { type: "tag", values: tags } });
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => String(n.target[0])) }));
  }, TAGS);
}

const blocking = (found: Found[]) => found.filter((f) => f.impact === "serious" || f.impact === "critical");
const describeFound = (found: Found[]) => found.map((f) => `${f.impact} ${f.id}: ${f.help} (${f.nodes.join(", ")})`);

/** Waits for the page to settle and for a heading to show, then scans. */
async function settleAndScan(page: Page, url: string): Promise<Found[]> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading").first()).toBeVisible();
  return scan(page);
}

test.describe("V1.1 axe sweep, organisation screens", () => {
  test("default look, Management: every V1.1 screen has no serious or critical violation", async ({ page }) => {
    test.setTimeout(400_000);
    await loginAs(page, "dev.management@figbloom.local");
    const report: Record<string, string[]> = {};
    for (const screen of [...V11_SCREENS, ...V11_MOBILE_SCREENS]) {
      const found = await settleAndScan(page, orgPath(screen.path));
      if (blocking(found).length) report[screen.name] = describeFound(blocking(found));
      if (found.length) test.info().annotations.push({ type: "axe-minor", description: `${screen.name}: ${describeFound(found).join(" | ")}` });
    }
    expect(report).toEqual({});
  });

  test("the two-step pages have no serious or critical violation", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    const report: Record<string, string[]> = {};
    for (const screen of V11_TOP_LEVEL) {
      const found = await settleAndScan(page, screen.path);
      if (blocking(found).length) report[screen.name] = describeFound(blocking(found));
    }
    expect(report).toEqual({});
  });

  for (const look of LOOKS.filter((l) => LOOK_NAMES.has(l.name))) {
    test(`${look.name}: no serious or critical violation on the core V1.1 screens`, async ({ browser }) => {
      test.setTimeout(300_000);
      // D-V11-01 was fixed (12 Nov 2026): a chat rule turned the avatar initials grey; see docs/V11_TEST_REPORT.md.
      const context = await browser.newContext(look.viewport ? { viewport: look.viewport } : {});
      const page = await context.newPage();
      await applyDevice(page, look.device);
      await loginAs(page, "dev.management@figbloom.local");
      const reset = await applyAccountLook(page, look);
      try {
        const report: Record<string, string[]> = {};
        const screens = [...V11_SCREENS.filter((s) => CORE.has(s.name)), ...(look.viewport ? V11_MOBILE_SCREENS : [])];
        for (const screen of screens) {
          const found = blocking(await settleAndScan(page, orgPath(screen.path)));
          if (found.length) report[screen.name] = describeFound(found);
        }
        expect(report).toEqual({});
      } finally {
        await reset();
        await context.close();
      }
    });
  }
});

async function signInAsSuperAdmin(request: APIRequestContext, page: Page) {
  const res = await request.post("/api/dev-session", { data: { email: SUPER_ADMIN } });
  test.skip(res.status() === 404, "The dev sign-in is closed here (production build). Run against `npm run dev` with ALLOW_DEV_ACCOUNTS=true.");
  expect(res.ok()).toBeTruthy();
  await page.context().addCookies((await request.storageState()).cookies);
}

test.describe("V1.1 axe sweep, platform console (dev Super Admin)", () => {
  test("PL1 to PL12: no serious or critical violation", async ({ request, page }) => {
    test.setTimeout(300_000);
    await signInAsSuperAdmin(request, page);
    const report: Record<string, string[]> = {};
    for (const screen of V11_PLATFORM_SCREENS) {
      const found = await settleAndScan(page, screen.path);
      if (blocking(found).length) report[screen.name] = describeFound(blocking(found));
      if (found.length) test.info().annotations.push({ type: "axe-minor", description: `${screen.name}: ${describeFound(found).join(" | ")}` });
    }
    expect(report).toEqual({});
  });

  test("platform mobile at 375 px: no serious or critical violation", async ({ browser, request }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    try {
      await signInAsSuperAdmin(request, page);
      const report: Record<string, string[]> = {};
      for (const screen of V11_PLATFORM_MOBILE) {
        const found = blocking(await settleAndScan(page, screen.path));
        if (found.length) report[screen.name] = describeFound(found);
      }
      expect(report).toEqual({});
    } finally {
      await context.close();
    }
  });
});
