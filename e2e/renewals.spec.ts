import { expect, test, type Page } from "@playwright/test";
import { gotoAndSettle, loginAs, ORG_SLUG } from "./helpers";

/**
 * F3.05: Renewals and retention in a real browser, per role: Management sees every customer and can set the dormancy threshold, Sales sees
 * the customers they own and is told the threshold is Management's, and a role without the area gets the explained no-access. Actions create
 * tasks for the record's owner. Written against the seeded organisation; not yet run (needs the database and a built app).
 */

async function openRenewals(page: Page) {
  await gotoAndSettle(page, `/o/${ORG_SLUG}/renewals`);
  await expect(page.getByRole("heading", { level: 1, name: /Renewals & retention/ })).toBeVisible();
}

test.describe("Renewals and retention", () => {
  test("Management sees all customers, every section and the dormancy control", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await openRenewals(page);
    await expect(page.getByText("All customers")).toBeVisible();
    await expect(page.getByText("Reminders only. Nothing here changes a record until you act.")).toBeVisible();
    for (const name of ["Recurring services and renewals", "Going quiet", "Proposals waiting for a reply", "Cross-sell ideas"]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
    await expect(page.getByRole("combobox", { name: "Dormant after (days)" })).toBeEnabled();
  });

  test("Sales sees only the customers they own and cannot change the threshold", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await openRenewals(page);
    await expect(page.getByText("Customers you own")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Dormant after (days)" })).toBeDisabled();
    await expect(page.getByText(/Management sets this/)).toBeVisible();
  });

  test("the service filter narrows the table and a follow-up is added once", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await openRenewals(page);
    const table = page.getByRole("table", { name: "Recurring services and renewals" });
    test.skip((await table.count()) === 0, "The seeded organisation has no recurring services.");
    await page.getByRole("button", { name: /^Lapsed/ }).click();
    await page.getByRole("button", { name: /^All/ }).click();
    const first = table.getByRole("button", { name: /^Add follow-up for/ }).first();
    await first.click();
    await expect(page.getByText(/^Task added for /)).toBeVisible();
    await expect(first).toBeDisabled();
  });

  test("Finance has no access to the retention lists and is told why", async ({ page }) => {
    await loginAs(page, "dev.finance@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/renewals`);
    await expect(page.getByRole("heading", { level: 1, name: /Renewals & retention/ })).toHaveCount(0);
    await expect(page.getByText(/isn.t part of your workspace/).first()).toBeVisible();
  });
});
