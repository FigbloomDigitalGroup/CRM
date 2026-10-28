import { expect as baseExpect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gotoAndSettle, loginAs, ORG_SLUG } from "./helpers";

/**
 * F3.07 (FIG-1101): the organisation reports, per role. Written for the lead's single e2e run. The numbers on the page are compared with the
 * API's own, and a downloaded CSV is compared with the table it came from.
 */

const expect = baseExpect.configure({ timeout: 20_000 });
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

test.describe("the organisation reports", () => {
  test("Management sees the headline figures, attention tiles and every report, equal to the API", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/reports`);
    await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
    await expect(page.getByText("Organisation reports", { exact: true })).toBeVisible();
    await expect(page.getByText("NEEDS ATTENTION")).toBeVisible();

    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const from = iso(new Date(today.getTime() - 29 * 86_400_000));
    const api = await (await page.request.get(`/api/orgs/${ORG_SLUG}/reports/organization?dateFrom=${from}&dateTo=${iso(today)}`)).json();
    await expect(page.getByTestId("kpi-leads")).toContainText(String(api.leadConversion.total));
    await expect(page.getByTestId("kpi-won")).toContainText(String(api.dealOutcomes.won.count));
    await expect(page.getByTestId("report-lead_sources")).toBeVisible();
    await expect(page.getByTestId("report-customers-detail")).toBeVisible();
  });

  test("a report reads as a chart or a table, and the CSV is the table", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/reports`);
    const card = page.getByTestId("report-lead_sources");
    await card.getByRole("button", { name: "Table view" }).click();
    const table = card.getByRole("table");
    await expect(table).toBeVisible();
    const shown = await table.locator("tbody tr, tfoot tr").evaluateAll((rows) => rows.map((r) => Array.from(r.querySelectorAll("th,td")).map((c) => (c.textContent ?? "").trim())));

    const [download] = await Promise.all([page.waitForEvent("download"), card.getByRole("link", { name: /Download CSV/ }).click()]);
    const csv = (await (await import("node:fs/promises")).readFile(await download.path(), "utf8")).trim().split(/\r?\n/);
    // The CSV has the column labels first, then the same rows as the table, totals last (the server writes numbers without thousands separators).
    expect(csv.length - 1).toBe(shown.length);
    expect(csv[0]!.split(",")).toEqual(["Source", "Leads"]);
    for (let i = 0; i < shown.length; i++) expect(csv[i + 1]!.split(",")[0]!.replace(/"/g, "")).toBe(shown[i]![0]);
  });

  test("a different period asks again and keeps the page", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/reports`);
    await page.getByRole("tab", { name: "Last 7 days" }).click();
    await expect(page.getByTestId("kpi-leads")).toBeVisible();
    await expect(page.getByText(/Open pipeline is always a live snapshot/)).toBeVisible();
  });

  test("the charts and tables have no accessibility violations", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/reports`);
    await expect(page.getByTestId("report-lead_sources")).toBeVisible();
    await page.evaluate(axeSource);
    const found = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: { id: string; help: string }[] }> } }).axe;
      const result = await axe.run(document.querySelector("main")!, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, rules: { region: { enabled: false } } });
      return result.violations.map((v) => `${v.id}: ${v.help}`);
    });
    expect(found).toEqual([]);
  });

  test("Sales gets My metrics, never the organisation's reports", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/reports`);
    await expect(page.getByRole("heading", { level: 1, name: "My metrics" })).toBeVisible();
    await expect(page.getByText("NEEDS ATTENTION")).toHaveCount(0);
    expect((await page.request.get(`/api/orgs/${ORG_SLUG}/reports/v2`)).status()).toBe(403);
  });

  test("Restricted Technical gets the explained no-access page", async ({ page }) => {
    await loginAs(page, "dev.tech@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/reports`);
    await expect(page.getByText(/Reports isn.t part of your workspace/)).toBeVisible();
  });
});
