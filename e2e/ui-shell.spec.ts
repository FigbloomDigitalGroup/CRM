import { expect, test, type Page } from "@playwright/test";
import { gotoAndSettle, loginAs, ORG_SLUG } from "./helpers";

/**
 * F1.03, F1.04, F1.01: the app shell in a real browser, for each role: the navigation the permission matrix allows (and no more), the identity
 * block, the light/dark switch, the layout at desktop, tablet and 375 px, and the session-expiring prompt.
 */

/** What each seeded role sees in the sidebar: written by hand from the design's navigation map and the signed permission model. */
const NAV: { email: string; label: string; links: string[] }[] = [
  { email: "dev.management@figbloom.local", label: "Management", links: ["Dashboard", "Leads", "Deals", "Tasks", "Calendar", "Companies", "Contacts", "Conversations", "Handoffs", "Renewals", "Payments", "Reports", "Settings"] },
  { email: "dev.sales@figbloom.local", label: "Sales", links: ["Dashboard", "Leads", "Deals", "Tasks", "Calendar", "Companies", "Contacts", "Conversations", "Handoffs", "Renewals", "My metrics", "Settings"] },
  { email: "dev.delivery@figbloom.local", label: "Delivery", links: ["Dashboard", "Won deals", "Tasks", "Calendar", "Companies", "Contacts", "Conversations", "Handoffs", "My metrics", "Settings"] },
  { email: "dev.finance@figbloom.local", label: "Finance", links: ["Dashboard", "Won deals", "Companies", "Contacts", "Payments", "My metrics", "Settings"] },
  { email: "dev.tech@figbloom.local", label: "Restricted Technical", links: ["My work", "Tasks", "Calendar", "Conversations", "Settings"] },
];

async function sidebarLinks(page: Page): Promise<string[]> {
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  return (await sidebar.getByRole("link").allInnerTexts()).map((t) => t.trim()).filter(Boolean);
}

test.describe("navigation per role", () => {
  for (const role of NAV) {
    test(`${role.label} sees exactly the navigation the matrix allows`, async ({ page }) => {
      await loginAs(page, role.email);
      expect(await sidebarLinks(page)).toEqual(role.links);
    });
  }

  test("hiding a link is not the boundary: a page the role cannot use still answers with the explained no-access", async ({ page }) => {
    await loginAs(page, "dev.finance@figbloom.local");
    expect(await sidebarLinks(page)).not.toContain("Leads");
    const response = await page.goto(`/o/${ORG_SLUG}/leads`);
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByText(/isn.t part of your workspace|aren.t available for your role|can.t see|not available/i).first()).toBeVisible();
  });
});

test.describe("top bar identity", () => {
  test("shows who you are, the organisation, and signs out", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const identity = page.getByRole("button", { name: /Account: Dev Sales/ });
    await expect(identity).toContainText("Dev Sales");
    await expect(identity).toContainText("Sales");
    await identity.click();
    const popover = page.getByRole("dialog", { name: /Account: Dev Sales/ });
    await expect(popover).toContainText("Signed in");
    await expect(popover).toContainText("Time zone");
    await expect(popover.getByRole("link", { name: "Profile and preferences" })).toBeVisible();
    await popover.getByRole("button", { name: /Sign out$/ }).click();
    await page.waitForURL(/\/login/);
  });

  test("Quick create offers only what the role may create", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await page.getByRole("button", { name: "New" }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["New lead", "New contact", "New company", "New task", "Log a call or note"]);
    await page.keyboard.press("Escape");
    await page.context().clearCookies();
    await loginAs(page, "dev.finance@figbloom.local");
    await expect(page.getByRole("button", { name: "New" })).toHaveCount(0); // Finance may create nothing
  });
});

test.describe("themes, light and dark", () => {
  test("the switch changes the whole app at once, survives a reload with no flash, and is remembered on this device", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    const app = page.locator(".fb-app");
    await expect(app).toHaveAttribute("data-fb-scheme", "light");
    const lightBg = await app.evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.getByRole("button", { name: "Switch to dark" }).click();
    await expect(app).toHaveAttribute("data-fb-scheme", "dark");
    const darkBg = await app.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(darkBg).not.toBe(lightBg);

    // No flash: the inline script has applied the device's choice before the page's scripts run, so the very first paint is already dark.
    await page.addInitScript(() => {
      // The first frame the browser is about to paint: by then the inline script must already have applied the device choice.
      const w = window as unknown as { __firstScheme?: string };
      const look = () => {
        const el = document.querySelector(".fb-app");
        if (!el) return requestAnimationFrame(look);
        w.__firstScheme = el.getAttribute("data-fb-scheme") ?? undefined;
      };
      requestAnimationFrame(look);
    });
    await page.reload();
    await expect(app).toHaveAttribute("data-fb-scheme", "dark");
    expect(await page.evaluate(() => (window as unknown as { __firstScheme?: string }).__firstScheme)).toBe("dark");
  });

  test("text size, bold and reduced motion are applied from the device store before the first paint", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await page.evaluate(() => localStorage.setItem("figbloom-device-prefs", JSON.stringify({ textSize: "EXTRA_LARGE", bold: true, reduceMotion: true })));
    await page.reload();
    const app = page.locator(".fb-app");
    await expect(app).toHaveAttribute("data-fb-text", "EXTRA_LARGE");
    await expect(app).toHaveAttribute("data-fb-bold", "1");
    await expect(app).toHaveAttribute("data-fb-motion", "1");
    await page.evaluate(() => localStorage.removeItem("figbloom-device-prefs"));
  });
});

test.describe("layout at desktop, tablet and 375px", () => {
  const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  test("desktop: full sidebar and the identity block with its text", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, "dev.management@figbloom.local");
    const box = await page.getByRole("complementary", { name: "Sidebar" }).boundingBox();
    expect(box!.width).toBeGreaterThan(240);
    await expect(page.locator(".fb-identity__text")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test("tablet: the sidebar collapses to icons and nothing overflows", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1100 });
    await loginAs(page, "dev.management@figbloom.local");
    const box = await page.getByRole("complementary", { name: "Sidebar" }).boundingBox();
    expect(box!.width).toBeLessThan(100);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test("375px: the sidebar becomes a menu, the identity collapses to the avatar, the popover is a bottom sheet, and nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAs(page, "dev.management@figbloom.local");
    await expect(page.getByRole("complementary", { name: "Sidebar" })).toBeHidden();
    await expect(page.locator(".fb-identity__text")).toBeHidden();
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("complementary", { name: "Sidebar" })).toBeVisible();
    await page.getByRole("complementary", { name: "Sidebar" }).getByRole("link", { name: "Leads" }).click();
    await page.waitForURL(/\/leads/);

    await page.getByRole("button", { name: /Account: / }).click();
    const sheet = await page.getByRole("dialog", { name: /Account: / }).boundingBox();
    expect(sheet!.x).toBe(0);
    expect(Math.round(sheet!.width)).toBe(375);
    expect(sheet!.y + sheet!.height).toBeGreaterThan(800); // anchored to the bottom
  });
});

test.describe("the session-expiring prompt", () => {
  test("appears at the warning time, 'Stay signed in' extends it, and expiry returns to sign-in", async ({ page }) => {
    await page.clock.install();
    await loginAs(page, "dev.management@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}`);
    await expect(page.getByRole("dialog", { name: "Still there?" })).toHaveCount(0);

    // The server computes the real times from the real clock; the browser's clock is moved by the test, so the extend answer is shaped to match it.
    await page.route("**/api/session/extend", async (route) => {
      const now = await page.evaluate(() => Date.now());
      const expiresAt = new Date(now + 8 * 3600_000).toISOString();
      const warnAt = new Date(now + 8 * 3600_000 - 300_000).toISOString();
      await route.fulfill({ json: { extended: true, session: { expiresAt, warnAt, canExtend: true } } });
    });

    // Default session: 8 hours, warning five minutes before the end.
    await page.clock.fastForward("07:56:00");
    const dialog = page.getByRole("dialog", { name: "Still there?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/ends in\s*[0-4]:\d\d/);

    await dialog.getByRole("button", { name: "Stay signed in" }).click();
    await expect(dialog).toHaveCount(0);

    await page.clock.fastForward("07:56:00");
    await expect(page.getByRole("dialog", { name: "Still there?" })).toBeVisible();
    await page.clock.fastForward("00:06:00");
    await page.waitForURL(/\/login\?reason=expired/);
  });
});
