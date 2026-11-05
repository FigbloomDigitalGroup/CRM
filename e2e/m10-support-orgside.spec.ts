import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

/**
 * Two-step sign-in, Customer Support workspace and organisation switcher (FIG-1165, 1167, 1178), now wired to the real API (M14 wiring, lane W6).
 *
 * - The login page check always runs: the frozen page must not link to or change for the new step.
 * - The V1.1 screens answer FEATURE_UNAVAILABLE for a V1 organisation, so the checks that need them run only against a server started with
 *   ACTIVE_RELEASE=v1.1 and E2E_RELEASE_V11=true (otherwise they are skipped, not failed). They need `ALLOW_DEV_ACCOUNTS=true` and the dev seed.
 * - Still on demo data (so not tested here): support access history and announcements (FIG-1192 org side), the suspended-screen preview cookie.
 */
const v11Server = process.env.E2E_RELEASE_V11 === "true";

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

test.describe("Customer Support workspace (FIG-1178)", () => {
  test.beforeEach(() => {
    test.skip(!v11Server, "needs a V1.1 server (ACTIVE_RELEASE=v1.1, E2E_RELEASE_V11=true)");
  });

  test("Customer Support opens the Support workspace", async ({ page }) => {
    await signInAs(page, "dev.support@figbloom.local");
    await page.goto(page.url().replace(/\/o\/([^/]+).*/, "/o/$1/support"));
    await expect(page.getByRole("heading", { name: "Support" })).toBeVisible();
    await expect(page.getByText(/KES/)).toHaveCount(0);
  });

  test("Sales gets the explained no-access", async ({ page }) => {
    await signInAs(page, "dev.sales@figbloom.local");
    await page.goto(page.url().replace(/\/o\/([^/]+).*/, "/o/$1/support"));
    await expect(page.getByText(/Customer Support/).first()).toBeVisible();
  });
});

test.describe("organisation switcher (FIG-1165)", () => {
  test.beforeEach(() => {
    test.skip(!v11Server, "needs a V1.1 server (ACTIVE_RELEASE=v1.1, E2E_RELEASE_V11=true)");
  });

  test("a member of one organisation sees no switcher", async ({ page }) => {
    await signInAs(page, "dev.sales@figbloom.local");
    await page.keyboard.press("Alt+o");
    await expect(page.getByRole("dialog", { name: "Switch organisation" })).toHaveCount(0);
  });
});
