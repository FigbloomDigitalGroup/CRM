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

  const importCard = page.locator(".card", { has: page.getByText("CSV file") });
  await importCard.locator('input[type="file"]').setInputFiles({
    name: "contacts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });

  // The mapping table appears once the header line is read, pre-filled by name.
  await expect(importCard.getByRole("heading", { name: "Column mapping" })).toBeVisible();
  await expect(
    importCard.getByRole("row", { name: /First name/ }).locator("select"),
  ).toHaveValue("First name");

  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/contacts/import") && r.request().method() === "POST",
    ),
    importCard.getByRole("button", { name: "Import", exact: true }).click(),
  ]);
  expect(response.ok()).toBe(true);

  await expect(importCard.getByText("Import complete")).toBeVisible();
  await expect(importCard).toContainText("3 row(s) read");
  await expect(importCard).toContainText("2 created");
  await expect(importCard).toContainText("1 failed");

  // The error report lists the failing row and downloads as a CSV.
  await expect(importCard.getByRole("table").getByRole("row").nth(1)).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    importCard.getByRole("button", { name: "Download error report (CSV)" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("import-errors.csv");
});

test("the import button stays disabled until the required columns are mapped", async ({
  page,
}) => {
  await loginAs(page, "dev.management@figbloom.local");
  await gotoAndSettle(page, "/o/figbloom/contacts");
  const importCard = page.locator(".card", { has: page.getByText("CSV file") });
  await importCard.locator('input[type="file"]').setInputFiles({
    name: "unmappable.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Foo,Bar\n1,2\n"),
  });
  await expect(importCard.getByRole("button", { name: "Import", exact: true })).toBeDisabled();
});
