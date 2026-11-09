import { expect, test } from "@playwright/test";
import { gotoAndSettle, loginAs, ORG_SLUG } from "./helpers";

/**
 * Two-step sign-in and organisation switcher (FIG-1165, 1167), now wired to the real API (M14 wiring, lane W6). The Customer Support workspace was removed on 5 Nov 2026 (decision 12).
 *
 * - The login page check always runs: the frozen page must not link to or change for the new step.
 * - The V1.1 screens answer FEATURE_UNAVAILABLE for a V1 organisation, so they need a server whose release reaches V1.1 (ACTIVE_RELEASE=v2, which
 *   playwright.config.ts sets) and the dev seed. Q2.01 (FIG-1179): the E2E_RELEASE_V11 gate was removed, because it made these checks skip in CI.
 * - The suspended screen (OS1) needs a suspended organisation. A test that suspended one would lock out the dev accounts, so the active-organisation side is
 *   tested here (the page sends a member home) and the paused screen itself is a step in docs/UAT_V1_1.md.
 */

const signInAs = (_page: import("@playwright/test").Page, email: string) => loginAs(_page, email);

test.describe("two-step sign-in is a new route, the login page is untouched (FIG-1167)", () => {
  test("the login page does not link to or change for the new step", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /sign in|welcome/i }).first()).toBeVisible();
    expect(await page.locator("a[href*='two-step']").count()).toBe(0);
  });

  test("the two-step page is a separate route that does not sign anyone in without a pending sign-in", async ({ page }) => {
    await page.goto("/two-step");
    await expect(page.getByText("Sign in again")).toBeVisible();
    await expect(page.getByLabel("Authenticator code")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Back to sign-in" })).toBeVisible();
  });
});

test.describe("organisation switcher (FIG-1165)", () => {
  test("TB4: a member of one organisation sees no switcher", async ({ page }) => {
    await signInAs(page, "dev.sales@figbloom.local");
    await page.keyboard.press("Alt+o");
    await expect(page.getByRole("dialog", { name: "Switch organisation" })).toHaveCount(0);
  });
});

test.describe("organisation side of the platform console (FIG-1166)", () => {
  test("OS1: the paused screen is not shown to a member of an active organisation; the page sends them home", async ({ page }) => {
    await signInAs(page, "dev.sales@figbloom.local");
    await page.goto(`/o/${ORG_SLUG}/suspended`);
    await page.waitForURL(new RegExp(`/o/${ORG_SLUG}/?$`));
    await expect(page.getByText("This workspace is paused")).toHaveCount(0);
  });

  test("OS6: Management opens Settings > Data requests and can choose an export or a deletion; nothing is requested", async ({ page }) => {
    await signInAs(page, "dev.management@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/settings?tab=datareq`);
    await expect(page.getByRole("heading", { name: /Data requests/ }).first()).toBeVisible();
    await expect(page.getByLabel("Type")).toBeVisible();
  });

  test("OS6: a member without the settings permission gets the explained no-access, not the requests", async ({ page }) => {
    await signInAs(page, "dev.sales@figbloom.local");
    await page.goto(`/o/${ORG_SLUG}/settings?tab=datareq`);
    await expect(page.getByLabel("Type")).toHaveCount(0);
  });
});
