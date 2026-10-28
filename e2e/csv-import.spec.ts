import { expect, test } from "@playwright/test";
import { gotoAndSettle, loginAs, uniqueSuffix } from "./helpers";

/**
 * FIG-801: CSV import with an error report. The file has two good rows and
 * one row with no first name (a required field), so the summary must show
 * 2 created / 1 failed, list the failing row, and offer the error CSV.
 */
test("contact CSV import reports created rows and an error report for the bad row", async ({
  page,
}) => {
  const suffix = uniqueSuffix();
  await loginAs(page, "dev.management@figbloom.local");
  await gotoAndSettle(page, "/o/figbloom/contacts");

  const csv = [
    "First name,Last name,Email",
    `Importa,One${suffix},importa.${suffix}@example.com`,
    `Importb,Two${suffix},importb.${suffix}@example.com`,
    `,NoFirstName${suffix},nofirst.${suffix}@example.com`,
  ].join("\n");

  await page.getByRole("button", { name: "Import CSV" }).click();
  const dialog = page.getByRole("dialog", { name: "Import contacts from CSV" });
  await dialog.getByLabel("Contacts CSV file").setInputFiles({
    name: "contacts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });

  // The mapping appears once the header line is read, pre-filled by name.
  await expect(dialog.getByText(/3 rows/)).toBeVisible();
  await expect(dialog.getByLabel(/First name/)).toHaveValue("First name");

  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/contacts/import") && r.request().method() === "POST",
    ),
    dialog.getByRole("button", { name: /^Import \d+ contacts?$/ }).click(),
  ]);
  expect(response.ok()).toBe(true);

  const tiles = dialog.locator(".fb-ct-result__tiles > div");
  await expect(tiles.filter({ hasText: "created" })).toContainText("2");
  await expect(tiles.filter({ hasText: "need attention" })).toContainText("1");

  // The error report lists the failing row and downloads as a CSV.
  await expect(dialog.getByText(/^Row \d+:/).first()).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "Download the error report" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("contacts-import-errors.csv");
});

test("the import button stays disabled until the required columns are mapped", async ({
  page,
}) => {
  await loginAs(page, "dev.management@figbloom.local");
  await gotoAndSettle(page, "/o/figbloom/contacts");
  await page.getByRole("button", { name: "Import CSV" }).click();
  const dialog = page.getByRole("dialog", { name: "Import contacts from CSV" });
  await dialog.getByLabel("Contacts CSV file").setInputFiles({
    name: "unmappable.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Foo,Bar\n1,2\n"),
  });
  await expect(dialog.getByRole("button", { name: /^Import \d+ contacts?$/ })).toBeDisabled();
});
