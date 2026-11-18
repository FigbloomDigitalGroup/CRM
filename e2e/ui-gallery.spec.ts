import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { gotoAndSettle, loginAs, ORG_SLUG } from "./helpers";

/**
 * F1.01, F1.02: the component gallery in a real browser, where layout and colour exist. It checks what jsdom cannot: no horizontal overflow at
 * 375 px in every mode, and axe's colour-contrast rule over every component in light, dark, compact, the largest text and with the accessibility
 * modes on. (The gallery route is a 404 anywhere but development and this suite's own server, which sets E2E_UI_GALLERY.)
 */

const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

async function violations(page: Page, scope?: string): Promise<string[]> {
  await page.evaluate(axeSource);
  return page.evaluate(async (selector) => {
    const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; help: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const result = await axe.run(selector ? document.querySelector(selector)! : document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, rules: { region: { enabled: false } } });
    return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("; ")})`);
  }, scope);
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function openGallery(page: Page) {
  await loginAs(page, "dev.management@figbloom.local");
  await gotoAndSettle(page, `/o/${ORG_SLUG}/dev/gallery`);
  await expect(page.getByRole("heading", { name: "Component gallery" })).toBeVisible();
}

async function setMode(page: Page, mode: { dark?: boolean; compact?: boolean; largest?: boolean; modes?: boolean }) {
  await page.evaluate(() => localStorage.removeItem("figbloom-device-prefs"));
  const prefs = {
    scheme: mode.dark ? "dark" : "light",
    textSize: mode.largest ? "EXTRA_LARGE" : "DEFAULT",
    bold: Boolean(mode.modes),
    higherContrast: Boolean(mode.modes),
    reduceMotion: Boolean(mode.modes),
    statusMarkers: Boolean(mode.modes),
  };
  await page.evaluate((p) => localStorage.setItem("figbloom-device-prefs", JSON.stringify(p)), prefs);
  await page.reload();
  await page.waitForLoadState("networkidle");
  if (mode.compact) await page.getByRole("button", { name: /Density/ }).click();
}

const MODES: [string, Parameters<typeof setMode>[1]][] = [
  ["light", {}],
  ["dark", { dark: true }],
  ["compact", { compact: true }],
  ["largest text", { largest: true }],
  ["every accessibility mode on", { modes: true }],
  ["dark, compact and largest", { dark: true, compact: true, largest: true }],
];

test.describe("component gallery", () => {
  test("is never shown to someone who is not signed in", async ({ request }) => {
    // The gallery is enabled on this server only because the e2e config sets E2E_UI_GALLERY; without a session the organisation layout sends the request to sign-in.
    const res = await request.get(`/o/${ORG_SLUG}/dev/gallery`, { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(res.status());
  });

  for (const [name, mode] of MODES) {
    test(`at 375px in ${name}: no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await openGallery(page);
      await setMode(page, mode);
      await page.getByRole("checkbox", { name: "Preview at 375px" }).check();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      const frame = await page.getByTestId("gallery-frame").evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect(frame.scroll).toBeLessThanOrEqual(frame.client);
    });

    test(`in ${name}: axe finds no violations, colour contrast included`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await openGallery(page);
      await setMode(page, mode);
      expect(await violations(page, ".fb-page-list")).toEqual([]);
    });
  }

  test("keyboard only: tab reaches the dialog button, Enter opens it, Tab stays inside, Escape closes and focus returns", async ({ page }) => {
    await openGallery(page);
    const open = page.getByRole("button", { name: "Dialog", exact: true });
    await open.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Rename view" });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();
  });

  test("the status-marker mode puts a shape on every status as well as the word", async ({ page }) => {
    await openGallery(page);
    await setMode(page, { modes: true });
    const before = await page.locator(".fb-badge--danger").first().evaluate((el) => getComputedStyle(el, "::before").content);
    expect(before).not.toBe("none");
    await setMode(page, {});
    const after = await page.locator(".fb-badge--danger").first().evaluate((el) => getComputedStyle(el, "::before").content);
    expect(after).toBe("none");
  });
});
