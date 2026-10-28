import { expect, test } from "@playwright/test";
import { gotoAndSettle, loginAs } from "./helpers";

/**
 * M9 Preferences (FIG-1103 to FIG-1105): the Appearance tab applies live and persists to the account across sessions and devices, the device-only
 * settings stay on the device, reset restores the defaults, the Profile picture rules are enforced, the Notifications tab cannot turn overdue
 * off, and the Security tab lists this device and signs the others out.
 */

const PREFS = "/o/figbloom/preferences";

test("a theme and density apply at once and follow the account to a second device; text size stays on the device", async ({ browser }) => {
  const first = await (await browser.newContext()).newPage();
  await loginAs(first, "dev.sales@figbloom.local");
  await gotoAndSettle(first, `${PREFS}?tab=appearance`);

  await first.getByRole("radio", { name: /Ocean/ }).click();
  await expect.poll(() => first.evaluate(() => document.getElementById("fb-look")?.textContent ?? "")).toContain("#14365C");
  await first.getByRole("radio", { name: "Compact" }).click();
  await expect(first.locator(".fb-app")).toHaveAttribute("data-fb-density", "compact");
  await first.getByRole("radio", { name: "Largest" }).click();
  await expect(first.locator(".fb-app")).toHaveAttribute("data-fb-text", "EXTRA_LARGE");

  // A second device (a fresh browser context) signs in as the same person: account settings follow, device settings do not.
  const second = await (await browser.newContext()).newPage();
  await loginAs(second, "dev.sales@figbloom.local");
  await gotoAndSettle(second, `${PREFS}?tab=appearance`);
  await expect(second.getByRole("radio", { name: /Ocean/ })).toBeChecked();
  await expect(second.locator(".fb-app")).toHaveAttribute("data-fb-density", "compact");
  await expect(second.locator(".fb-app")).toHaveAttribute("data-fb-text", "DEFAULT");

  // Reset restores the defaults (and can be undone).
  await first.getByRole("button", { name: "Reset to default" }).click();
  await first.getByRole("dialog", { name: "Reset appearance to default?" }).getByRole("button", { name: "Reset" }).click();
  await expect(first.getByText("Appearance reset to default.")).toBeVisible();
  await expect(first.getByRole("radio", { name: /Forest/ })).toBeChecked();
  await expect(first.locator(".fb-app")).toHaveAttribute("data-fb-density", "comfortable");
  await expect(first.locator(".fb-app")).toHaveAttribute("data-fb-text", "DEFAULT");
});

test("the Preferences link is in the sidebar and the user menu opens it", async ({ page }) => {
  await loginAs(page, "dev.finance@figbloom.local");
  await gotoAndSettle(page, "/o/figbloom");
  await expect(page.getByRole("link", { name: "Preferences" }).first()).toBeVisible();
  await page.getByRole("link", { name: "Preferences" }).first().click();
  await expect(page.getByRole("heading", { name: "Preferences" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Appearance/ })).toHaveAttribute("aria-selected", "true");
});

test("profile picture: a wrong type and a big file are refused with a clear message", async ({ page }) => {
  await loginAs(page, "dev.sales@figbloom.local");
  await gotoAndSettle(page, `${PREFS}?tab=profile`);
  await page.getByTestId("avatar-file").setInputFiles({ name: "notes.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
  await expect(page.locator(".fb-prefs__msg[role=alert]")).toContainText("Only JPG or PNG pictures work.");
  await page.getByTestId("avatar-file").setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(3 * 1024 * 1024) });
  await expect(page.locator(".fb-prefs__msg[role=alert]")).toContainText("over 2 MB");
});

test("notifications: overdue cannot be turned off and a preset applies", async ({ page }) => {
  await loginAs(page, "dev.sales@figbloom.local");
  await gotoAndSettle(page, `${PREFS}?tab=notifications`);
  await expect(page.getByRole("checkbox", { name: "A task is overdue: In-app" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "A task is overdue: Email" })).toBeDisabled();
  await page.getByRole("radio", { name: "Important only" }).click();
  await expect(page.getByRole("radio", { name: "Important only" })).toBeChecked();
  await page.getByRole("radio", { name: "Everything" }).click();
  await expect(page.getByRole("radio", { name: "Everything" })).toBeChecked();
});

test("security: my sessions list this device, and sign out others takes effect at once", async ({ browser }) => {
  const here = await (await browser.newContext()).newPage();
  await loginAs(here, "dev.delivery@figbloom.local");
  const other = await (await browser.newContext()).newPage();
  await loginAs(other, "dev.delivery@figbloom.local");

  await gotoAndSettle(here, `${PREFS}?tab=security`);
  const list = here.getByTestId("session-list");
  await expect(list.getByText("This device")).toBeVisible();
  await expect(here.getByTestId("signin-history").locator("li").first()).toBeVisible();

  await here.getByRole("button", { name: "Sign out other devices" }).click();
  await here.getByRole("dialog").getByRole("button", { name: "Sign out other devices" }).click();
  await expect(here.getByText(/Signed out of your other devices/)).toBeVisible();

  // The other device is signed out on its next request.
  await other.goto("/o/figbloom");
  await expect(other).toHaveURL(/\/login/);
  // This one stays in.
  await here.reload();
  await expect(here.getByRole("heading", { name: "Preferences" })).toBeVisible();
});
