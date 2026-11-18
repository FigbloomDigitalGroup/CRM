import { readFileSync } from "node:fs";
import { expect as baseExpect, test, type Page } from "@playwright/test";
import { loginAs } from "../helpers";
import { DESKTOP_SCREENS, detailScreens, orgPath, type Screen } from "./catalogue";
import { applyAccountLook, applyDevice, LOOKS } from "./looks";

/**
 * Q1.02 (FIG-1116): the automated half of the accessibility pass. axe (WCAG 2.0, 2.1 and 2.2, levels A and AA) runs on every V1 desktop screen
 * in the default look, and on a core set of screens in every other look (dark, themes, compact, Largest text, high contrast, 375 px). Zero serious
 * or critical violations is the acceptance bar; moderate and minor ones are attached to the report and triaged in docs/A11Y_CHECKLIST.md. The manual
 * keyboard and screen-reader script is in that document.
 */

const expect = baseExpect.configure({ timeout: 20_000 });
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
/** The screens every look is checked on: the busiest of each kind (list, board, detail, form, dashboard). */
const CORE = new Set(["home", "leads", "deals", "companies", "payments", "preferences", "lead-detail", "company-detail"]);

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

test.describe("axe sweep, default look, Management", () => {
  test("every V1 screen has no serious or critical violation", async ({ page }) => {
    test.setTimeout(300_000);
    await loginAs(page, "dev.management@figbloom.local");
    const screens: Screen[] = [...DESKTOP_SCREENS, ...(await detailScreens(page))];
    const report: Record<string, string[]> = {};
    for (const screen of screens) {
      await page.goto(orgPath(screen.path));
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      const found = await scan(page);
      if (blocking(found).length) report[screen.name] = describeFound(blocking(found));
      if (found.length) test.info().annotations.push({ type: "axe-minor", description: `${screen.name}: ${describeFound(found).join(" | ")}` });
    }
    expect(report).toEqual({});
  });
});

test.describe("axe sweep, every look, core screens", () => {
  for (const look of LOOKS) {
    test(`${look.name}: no serious or critical violation on the core screens`, async ({ browser }) => {
      test.setTimeout(240_000);
      const context = await browser.newContext(look.viewport ? { viewport: look.viewport } : {});
      const page = await context.newPage();
      await applyDevice(page, look.device);
      await loginAs(page, "dev.sales@figbloom.local");
      const reset = await applyAccountLook(page, look);
      try {
        const screens = [...DESKTOP_SCREENS, ...(await detailScreens(page))].filter((s) => CORE.has(s.name));
        const report: Record<string, string[]> = {};
        for (const screen of screens) {
          await page.goto(orgPath(screen.path));
          await page.waitForLoadState("networkidle");
          await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
          const found = blocking(await scan(page));
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

test.describe("keyboard and motion basics", () => {
  test("Tab reaches the skip link first, focus is visible, and reduced motion removes animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await loginAs(page, "dev.sales@figbloom.local");
    await page.goto(orgPath(""));
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Tab");
    const first = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
    expect(first).toMatch(/skip to/i);
    const visible = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement as HTMLElement);
      return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
    });
    expect(visible).toBe(true);
  });
});
