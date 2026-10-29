import { expect as baseExpect, test } from "@playwright/test";
import { gotoAndSettle, loginAs, ORG_SLUG } from "./helpers";

/**
 * M10 commercial screens on demo data (FIG-1168 to FIG-1170, FIG-1174, FIG-1193, FIG-1194), per role, in a real browser.
 *
 * These screens exist only where demo screens are allowed and the organisation's release reaches V1.1 (the quote, approval and forecast permissions
 * are stripped before that). Build and start the app for this run with
 *   DEMO_SCREENS=true NEXT_PUBLIC_DEMO_SCREENS=true ACTIVE_RELEASE=v2
 * and set E2E_DEMO_SCREENS=true. Without it the suite is skipped, not failed: a plain V1 server must answer 404 for these pages.
 */
const expect = baseExpect.configure({ timeout: 20_000 });
const enabled = process.env.E2E_DEMO_SCREENS === "true";

test.describe("commercial screens on demo data", () => {
  test.skip(!enabled, "needs DEMO_SCREENS, NEXT_PUBLIC_DEMO_SCREENS and ACTIVE_RELEASE=v2 on the server");

  test("Sales builds a quote, margin stays hidden, and a deep discount waits for Management who then decides it", async ({ page, browser }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/quotes/d6`);
    await expect(page.getByText("Demo data").first()).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Margin" })).toHaveCount(0);

    await page.getByLabel("Add a catalogue item").selectOption("cat4");
    await page.getByLabel("Discount %").fill("12");
    await page.getByRole("button", { name: /Request approval/ }).click();
    await expect(page.getByText("Waiting for Management.")).toBeVisible();
    await expect(page.getByLabel(/Quantity for Website/)).toHaveAttribute("readonly", "");

    await page.getByRole("button", { name: /New version/ }).click();
    await expect(page.getByText("Version 2")).toBeVisible();
    await expect(page.getByText("New version from v1")).toBeVisible();
    await page.getByRole("button", { name: /Preview document/ }).click();
    await expect(page.getByRole("region", { name: /document preview/ })).not.toContainText(/margin|cost/i);

    // Management sees the margin and the inbox, and the reason reaches the requester's view.
    const manager = await browser.newPage();
    await loginAs(manager, "dev.management@figbloom.local");
    await gotoAndSettle(manager, `/o/${ORG_SLUG}/quotes/d3`);
    await expect(manager.getByRole("columnheader", { name: "Margin" })).toBeVisible();
    await gotoAndSettle(manager, `/o/${ORG_SLUG}/approvals`);
    const card = manager.getByRole("heading", { name: /Mwangaza Schools/ }).locator("xpath=ancestor::li");
    await card.getByRole("button", { name: "Decline" }).click();
    await expect(card.getByRole("alert")).toContainText("Say why");
    await card.getByPlaceholder(/Reason/).fill("Try 5%");
    await card.getByRole("button", { name: "Decline" }).click();
    await manager.getByRole("tab", { name: /Decided/ }).click();
    await expect(manager.getByText(/Declined · Try 5%/)).toBeVisible();
  });

  test("forecast: Management sees the team and edits a target; Sales sees only their own deals", async ({ page, browser }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/forecast`);
    await expect(page.getByRole("img", { name: /Weighted closes/ })).toBeVisible();
    await page.getByLabel("Target for Dev Sales").fill("1800000");
    await expect(page.getByText(/KES 1.8M/).first()).toBeVisible();
    await page.getByRole("button", { name: "Table" }).click();
    await expect(page.getByRole("table", { name: "Expected closes by month" })).toBeVisible();

    const sales = await browser.newPage();
    await loginAs(sales, "dev.sales@figbloom.local");
    await gotoAndSettle(sales, `/o/${ORG_SLUG}/forecast`);
    await expect(sales.getByText("Savannah Logistics")).toHaveCount(0);
    await expect(sales.getByLabel(/Target for/)).toHaveCount(0);
  });

  test("settings editors explain the impact, block bad input and keep a token's secret to one viewing", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/settings?tab=catalogue`);
    await page.getByLabel("Price for Support retainer").fill("0");
    await expect(page.getByRole("alert")).toContainText("price must be more than 0");
    await page.getByLabel("Price for Support retainer").fill("30000");
    await expect(page.getByRole("status")).toContainText("already sent keep the price");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Catalogue changed")).toBeVisible();

    await gotoAndSettle(page, `/o/${ORG_SLUG}/settings?tab=developers`);
    await page.getByRole("button", { name: /New token/ }).click();
    await page.getByLabel("Name").fill("E2E token");
    await page.getByLabel("deals:read").check();
    await page.getByRole("button", { name: "Create token" }).click();
    const secret = await page.getByTestId("secret-once").innerText();
    expect(secret).toMatch(/^fbk_live_/);
    await page.getByRole("button", { name: "I have saved it" }).click();
    await expect(page.getByText(secret)).toHaveCount(0);
  });

  test("the public signing page works on a phone, in Swahili, without signing in", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 700 }, hasTouch: true });
    const page = await context.newPage();
    await page.goto("/sign/demo-unsigned");
    await expect(page.getByRole("heading", { name: /Quote Q-2026-032/ })).toBeVisible();
    await page.getByRole("button", { name: "SW" }).click();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Saini na ukubali" }).click();
    await expect(page.getByText("Imesainiwa. Asante.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.goto("/sign/not-a-real-link");
    await expect(page.getByRole("alert")).toContainText("This link is not valid");
    await context.close();
  });
});

test("without demo screens enabled the commercial pages do not exist", async ({ page }) => {
  test.skip(enabled, "only meaningful on a server without DEMO_SCREENS");
  await loginAs(page, "dev.management@figbloom.local");
  const res = await page.goto(`/o/${ORG_SLUG}/approvals`);
  expect(res?.status()).toBe(404);
  const sign = await page.goto("/sign/demo-unsigned");
  expect(sign?.status()).toBe(404);
});
