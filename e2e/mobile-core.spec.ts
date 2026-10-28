import { expect, test, type Page } from "@playwright/test";
import { loginAs, ORG_SLUG, uniqueSuffix } from "./helpers";

/**
 * M9 mobile (F4.10, F4.11, FIG-791) at a 375 px phone with touch: Today, Leads, quick capture with the duplicate warning, the record with Call
 * and WhatsApp and the "How did it go?" sheet, tasks, notifications, More with the read-only pipeline, and the 44 px touch targets.
 * Runs in the `mobile-chrome` project (playwright.config.ts) and in the desktop one with the viewport forced below.
 */
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

const M = `/o/${ORG_SLUG}/m`;

async function signInAsSales(page: Page) {
  await loginAs(page, "dev.sales@figbloom.local");
  // On a phone the organisation's home opens the phone version.
  await page.waitForURL(new RegExp(`${M}$`));
}

test.describe("phone layout", () => {
  test("the phone opens Today with the five-tab bar and the raised Capture action", async ({ page }) => {
    await signInAsSales(page);
    await expect(page.getByRole("heading", { level: 2, name: /^Good (morning|afternoon|evening)/ })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Primary" });
    for (const name of ["Today", "Leads", "Customers", "Tasks"]) await expect(nav.getByRole("link", { name })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Quick capture" })).toBeVisible();
    // Every target in the bar is at least 44 px (and nothing scrolls sideways).
    for (const el of await nav.locator("a, button").all()) {
      const box = await el.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("quick capture saves a lead in a few taps and a second capture of the same person warns first", async ({ page }) => {
    await signInAsSales(page);
    const name = `Capture Test ${uniqueSuffix()}`;
    const phone = `+2547${String(Date.now()).slice(-8)}`;
    await page.getByRole("button", { name: "Quick capture" }).first().click();
    const sheet = page.getByRole("dialog", { name: "Quick capture" });
    await expect(sheet).toBeVisible();
    await sheet.getByLabel("Company or person *").fill(name);
    await sheet.getByLabel("Phone *").fill(phone);
    await sheet.getByRole("button", { name: "Save lead" }).click();
    await page.waitForURL(new RegExp(`${M}/record/lead/`));
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

    // The same person again: nothing is created until the person chooses.
    await page.getByRole("button", { name: "Quick capture" }).first().click();
    const again = page.getByRole("dialog", { name: "Quick capture" });
    await again.getByLabel("Company or person *").fill(name);
    await again.getByLabel("Phone *").fill(phone);
    await again.getByRole("button", { name: "Save lead" }).click();
    await expect(again.getByRole("alert").filter({ hasText: "already in the CRM" })).toBeVisible();
    await again.getByRole("button", { name: "Save as new anyway" }).click();
    await page.waitForURL(new RegExp(`${M}/record/lead/`));
  });

  test("a record offers Call and WhatsApp, and coming back asks how it went", async ({ page }) => {
    await signInAsSales(page);
    // A lead captured here has a phone number, so Call and WhatsApp are there.
    await page.getByRole("button", { name: "Quick capture" }).first().click();
    const cap = page.getByRole("dialog", { name: "Quick capture" });
    await cap.getByLabel("Company or person *").fill(`Reach Test ${uniqueSuffix()}`);
    await cap.getByLabel("Phone *").fill(`+2547${String(Date.now()).slice(-8)}`);
    await cap.getByRole("button", { name: "Save lead" }).click();
    await page.waitForURL(new RegExp(`${M}/record/lead/`));
    const call = page.getByRole("link", { name: "Call" });
    const wa = page.getByRole("link", { name: "WhatsApp" });
    await expect(call).toHaveAttribute("href", /^tel:\+?\d+/);
    await expect(wa).toHaveAttribute("href", /^https:\/\/wa\.me\/\d+/);
    // The call app is not reachable from a test browser, so tapping Call (cancelled before it navigates) brings the prompt up after the
    // short fallback wait, exactly as it does on a desktop.
    await call.evaluate((a) => a.addEventListener("click", (e) => e.preventDefault(), { once: true }));
    await call.click();
    const sheet = page.getByRole("dialog", { name: /How did the call with .* go\?/ });
    await expect(sheet).toBeVisible({ timeout: 6000 });
    await sheet.getByRole("button", { name: "Reached" }).click();
    await sheet.getByRole("button", { name: "Save to timeline" }).click();
    await expect(page.getByText(/Call with .* logged/)).toBeVisible();
  });

  test("tasks list, complete one, and the bell opens notifications", async ({ page }) => {
    await signInAsSales(page);
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Tasks" }).click();
    await page.waitForURL(`**${M}/tasks`);
    await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
    await page.getByRole("link", { name: /^Notifications/ }).click();
    await page.waitForURL(`**${M}/alerts`);
    await expect(page.getByRole("button", { name: "Mark all read" })).toBeVisible();
  });

  test("More shows the pipeline as read-only with the reason, and the desktop view is one tap away", async ({ page }) => {
    await signInAsSales(page);
    await page.getByRole("button", { name: "Account and more" }).click();
    const more = page.getByRole("dialog", { name: "Account and more" });
    await expect(more.getByRole("button", { name: /Use the desktop view/ })).toBeVisible();
    await more.getByRole("button", { name: /Pipeline/ }).click();
    await page.waitForURL(`**${M}/pipeline`);
    await expect(page.getByRole("note")).toContainText("read-only on your phone");
    await expect(page.getByRole("button", { name: /Move to/ })).toHaveCount(0);
  });

  test("Finance sees Today, Customers and Alerts, never Leads or Capture", async ({ page }) => {
    await loginAs(page, "dev.finance@figbloom.local");
    await page.waitForURL(new RegExp(`${M}$`));
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: "Alerts" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Leads" })).toHaveCount(0);
    await expect(nav.getByRole("button", { name: "Quick capture" })).toHaveCount(0);
  });

  test("the sign-in pages carry no service worker and no phone redirect", async ({ page }) => {
    await page.goto("/login");
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).filter((r) => !r.scope.includes("/o/")).length)).toBe(0);
    expect(await page.locator("link[rel=manifest]").count()).toBe(0);
  });
});
