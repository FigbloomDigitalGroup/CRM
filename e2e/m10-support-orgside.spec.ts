import { expect, test } from "@playwright/test";

/**
 * M10, agent B (FIG-1165, 1166, 1167, 1178, 1192 organisation side). Demo-data screens: these specs check the flows and the hard rules around
 * them (the frozen login page is untouched, the two-step step is a new route, Customer Support sees no money). They need the dev server with
 * `ALLOW_DEV_ACCOUNTS=true`, the seeded organisation and the e2e helper sign-in. Written for the demo; run them with `npm run e2e`.
 */

async function signInAs(page: import("@playwright/test").Page, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(email.split("@")[0]!.replace("dev.", ""), "i") }).first().click();
  await page.waitForURL(/\/o\//);
}

test.describe("two-step sign-in is a new route, the login page is untouched (FIG-1167)", () => {
  test("wrong code counts attempts, a good code signs in", async ({ page }) => {
    await page.goto("/two-step");
    await page.getByLabel("Authenticator code").fill("000000");
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page.getByText(/4 attempts left/)).toBeVisible();
    await page.getByLabel("Authenticator code").fill("123456");
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page.getByText(/Signed in/)).toBeVisible();
  });

  test("the login page does not link to or change for the new step", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /sign in|welcome/i }).first()).toBeVisible();
    expect(await page.locator("a[href*='two-step']").count()).toBe(0);
  });
});

test.describe("Customer Support workspace (FIG-1178)", () => {
  test("sees tickets and a customer without deal values or payments", async ({ page }) => {
    await signInAs(page, "dev.support@figbloom.local");
    await page.goto(page.url().replace(/\/o\/([^/]+).*/, "/o/$1/support"));
    await expect(page.getByRole("heading", { name: "Support" })).toBeVisible();
    await page.getByRole("link", { name: "Payroll export misses the overtime column" }).click();
    await expect(page.getByText(/aren.t shown to Customer Support|shown to Customer Support/)).toBeVisible();
    await expect(page.getByText(/KES/)).toHaveCount(0);
  });

  test("Sales gets the explained no-access", async ({ page }) => {
    await signInAs(page, "dev.sales@figbloom.local");
    await page.goto(page.url().replace(/\/o\/([^/]+).*/, "/o/$1/support"));
    await expect(page.getByText(/Customer Support/).first()).toBeVisible();
    await expect(page.getByText("Payroll export misses the overtime column")).toHaveCount(0);
  });
});

test.describe("support access and announcements (FIG-1192)", () => {
  test("Management approves, sees the banner and ends it in one click", async ({ page }) => {
    await signInAs(page, "dev.management@figbloom.local");
    await expect(page.getByText("Figbloom Support asks to view your workspace")).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText(/Figbloom Support is viewing/)).toBeVisible();
    await page.getByRole("button", { name: "End now" }).click();
    await expect(page.getByText(/Figbloom Support is viewing/)).toHaveCount(0);
  });
});

test.describe("organisation switcher and suspended screen (FIG-1165, FIG-1166)", () => {
  test("Alt+O opens the switcher; a suspended organisation is disabled", async ({ page }) => {
    await signInAs(page, "dev.sales@figbloom.local");
    await page.keyboard.press("Alt+o");
    await expect(page.getByRole("dialog", { name: "Switch organisation" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Westlands Clinics/ })).toHaveAttribute("aria-disabled", "true");
  });

  test("the paused screen shows no navigation and offers sign out", async ({ page, context, baseURL }) => {
    await signInAs(page, "dev.management@figbloom.local");
    await context.addCookies([{ name: "fb_demo_suspended", value: "1", url: baseURL! }]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "This workspace is paused" })).toBeVisible();
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });
});
