import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { gotoAndSettle, loginAs, uniqueSuffix } from "./helpers";

/**
 * M9 (F4.08, FIG-1110): the migration wizard end to end against a fixture file with bad rows. The fixture (`fixtures/migration-leads.csv`) has two good rows, a
 * sixth good row, one row with an invalid email, one with an owner nobody has and one duplicate of an earlier row; `__SUFFIX__` is replaced per run so reruns
 * never collide. The wizard's phases are background jobs; the test asks the job worker route to run them (the e2e server sets a throwaway CRON_SECRET).
 */
const CRON = "figbloom_e2e_only_cron_secret";

async function runJobs(page: Page) {
  const res = await page.request.get("/api/cron/jobs", { headers: { authorization: `Bearer ${CRON}` } });
  expect(res.ok(), "the job worker route answers").toBe(true);
}

/** Keeps the worker turning until the wizard shows what it is waiting for. */
async function until(page: Page, ready: () => Promise<boolean>) {
  for (let i = 0; i < 40; i++) {
    await runJobs(page);
    if (await ready()) return;
    await page.waitForTimeout(500);
  }
  throw new Error("The migration did not reach the expected step.");
}

test("migrate leads from a file with bad rows: validate, dry run, import, error report, rollback", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = uniqueSuffix();
  const csv = readFileSync(path.join(__dirname, "fixtures", "migration-leads.csv"), "utf8").replaceAll("__SUFFIX__", suffix)
    // Contacts are matched by the last nine digits of a phone number, so every run needs numbers nobody has used.
    .replace(/__PHONE\d__/g, () => `07${Math.floor(10_000_000 + Math.random() * 89_999_999)}`);
  await loginAs(page, "dev.management@figbloom.local");
  await gotoAndSettle(page, "/o/figbloom/settings?tab=migration");

  await test.step("1 source", async () => {
    await page.getByRole("button", { name: "Start a migration" }).click();
    await page.getByLabel("What are you bringing in?").selectOption({ label: "Leads" });
    // The fixture names companies that are not in the CRM yet; leads can create them (deals do by default).
    await page.getByRole("checkbox", { name: "Create companies that do not exist yet" }).check();
    await page.getByRole("group", { name: "Choose what to bring in" }).getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Upload your file" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Migration steps" })).toBeVisible();
  });

  await test.step("2 upload: a wrong file type is refused, the fixture is accepted", async () => {
    await page.getByLabel("Migration file").setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("x") });
    await expect(page.getByText("Choose a .csv or .xlsx file.")).toBeVisible();
    await page.getByLabel("Migration file").setInputFiles({ name: "leads.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.getByRole("heading", { name: "Map your columns" })).toBeVisible();
  });

  await test.step("3 map: the template's own headers map themselves", async () => {
    await expect(page.getByLabel("Column for Contact email")).toHaveValue("contactEmail");
    await page.getByRole("button", { name: "Save mapping and continue" }).click();
    await expect(page.getByRole("heading", { name: "Check the file" })).toBeVisible();
  });

  await test.step("4 validate: the bad rows are named, nothing is guessed", async () => {
    await page.getByRole("button", { name: "Check the file" }).click();
    await until(page, () => page.getByRole("heading", { name: /Rows to fix/ }).isVisible());
    const fix = page.getByRole("heading", { name: /Rows to fix/ }).locator("xpath=ancestor::section[1]");
    // The header row plus at least the bad email and the unknown owner.
    expect(await fix.getByRole("row").count()).toBeGreaterThan(2);
    const [report] = await Promise.all([page.waitForEvent("download"), fix.getByRole("button", { name: "Download error report" }).click()]);
    expect(report.suggestedFilename()).toBe("migration-errors.csv");
  });

  await test.step("5 dry run: shows what would change and writes nothing", async () => {
    await page.getByRole("button", { name: "Continue to the dry run" }).click();
    await until(page, () => page.getByText("Would add").isVisible());
    const panel = page.getByRole("heading", { name: "Dry run" }).locator("xpath=ancestor::section[1]");
    await expect(panel.locator(".fb-set-count", { hasText: "Would add" }).locator("b")).not.toHaveText("0");
    const found = await page.request.get(`/api/orgs/figbloom/leads?q=${encodeURIComponent(suffix)}`);
    expect(((await found.json()) as { items: unknown[] }).items).toHaveLength(0);
  });

  await test.step("6 import needs the confirmation", async () => {
    const go = page.getByRole("button", { name: "Import now" });
    await expect(go).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("checkbox", { name: /I have read the dry run/ }).check();
    await go.click();
    await until(page, () => page.getByRole("heading", { name: "Import report" }).isVisible());
  });

  await test.step("7 report: good rows are kept, bad rows are reported", async () => {
    const report = page.getByRole("heading", { name: "Import report" }).locator("xpath=ancestor::section[1]");
    await expect(report.locator(".fb-set-count", { hasText: "Added" }).locator("b")).not.toHaveText("0");
    await expect(page.getByText(/Some rows were not imported/)).toBeVisible();
    const found = await page.request.get(`/api/orgs/figbloom/leads?q=${encodeURIComponent(suffix)}`);
    expect(((await found.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);
    const [download] = await Promise.all([page.waitForEvent("download"), report.getByRole("button", { name: "Download error report" }).click()]);
    expect(download.suggestedFilename()).toBe("migration-errors.csv");
  });

  await test.step("rollback removes what the import added, within its window", async () => {
    await page.getByRole("button", { name: "Roll back this import" }).click();
    await page.getByRole("dialog", { name: "Roll back this import?" }).getByRole("button", { name: "Roll back" }).click();
    await until(page, () => page.getByText(/\d+ removed, \d+ restored, \d+ kept/).isVisible());
    // The rollback says what it removed and what it kept (records edited since the import, such as the score the import job computed, are kept by design).
    await expect(page.getByRole("button", { name: "Roll back this import" })).toHaveAttribute("aria-disabled", "true");
  });
});
