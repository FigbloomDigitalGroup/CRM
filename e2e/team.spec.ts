import { expect, test } from "@playwright/test";
import { gotoAndSettle, loginAs, ORG_SLUG } from "./helpers";

/**
 * P2-15 (FIG-1598): the Team page in a real browser. Management reads the whole team and opens a member; Sales does not get the page, the
 * link or the data (the explained no-access state, and the API refuses the same call).
 */

const TEAM = `/o/${ORG_SLUG}/team`;

test.describe("Team page", () => {
  test("Management sees the summary, the members and a member's detail, and can use it by keyboard", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await expect(page.getByRole("link", { name: "Team", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Team", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${TEAM}$`), { timeout: 45_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();

    const summary = page.getByRole("region", { name: "Team summary" });
    await expect(summary).toBeVisible({ timeout: 90_000 });
    await expect(summary).toContainText("Open leads");
    await expect(summary).toContainText("Overdue tasks");

    await expect(page.getByRole("heading", { name: "Workload balance" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
    await expect(page.getByRole("table", { name: "Team members" })).toBeVisible();

    // The date range changes the numbers without leaving the page.
    await page.getByRole("tab", { name: "30 days" }).click();
    await expect(page.getByRole("tab", { name: "30 days" })).toHaveAttribute("aria-selected", "true");

    // Filter by name from the keyboard; the dev Sales member is in the list.
    await page.getByRole("searchbox", { name: "Search team members" }).fill("dev.sales");
    const rows = page.getByRole("table", { name: "Team members" }).getByRole("row");
    await expect.poll(() => rows.count(), { timeout: 20_000 }).toBeLessThan(5); // the filter has narrowed the list to the dev Sales accounts
    const open = page.getByRole("table", { name: "Team members" }).locator("tbody").getByRole("button", { name: /^Open / }).first(); // not the sortable "Open leads" header
    await expect(open).toBeVisible();
    await open.focus();
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("heading", { name: "Activity, last 30 days" })).toBeVisible({ timeout: 90_000 });
    await expect(drawer.getByRole("link", { name: "Open in Members settings" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
  });

  test("Management finds the page in the command palette", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}`);
    await page.getByRole("button", { name: /Command palette/ }).click();
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox").fill("go to team");
    await dialog.getByRole("option", { name: /Go to Team/ }).click();
    await expect(page).toHaveURL(new RegExp(`${TEAM}$`), { timeout: 45_000 });
  });

  test("Sales has no Team link, gets the explained no-access state, and the API refuses the same person", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await expect(page.getByRole("link", { name: "Team", exact: true })).toHaveCount(0);
    await page.goto(TEAM);
    await expect(page.getByRole("region", { name: /Team/ })).toContainText("Your role");
    await expect(page.getByRole("table", { name: "Team members" })).toHaveCount(0);

    for (const path of ["summary", "members", "attention"]) {
      const res = await page.request.get(`/api/orgs/${ORG_SLUG}/team/${path}`);
      expect(res.status(), path).toBe(403);
      const body = await res.json();
      expect(body.denial?.yourRole ?? body.error).toBeTruthy();
    }
  });
});
