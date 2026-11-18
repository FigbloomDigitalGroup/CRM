import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { apiPost, gotoAndSettle, loginAs, ORG_SLUG, uniqueSuffix } from "./helpers";

/**
 * FIG-1680 follow-up (requested by Sales): import from an Excel sheet, and export as PDF. Both sit on top of the CSV paths, so the person
 * signs in as Sales (not Management) and checks that the same screens, rights and rows apply.
 */
const SALES = "dev.sales@figbloom.local";
const ORG = "figbloom";

async function xlsx(rows: (string | number)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Contacts");
  for (const r of rows) sheet.addRow(r);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

test("Sales imports contacts from an Excel sheet and sees them in the list", async ({ page }) => {
  const suffix = uniqueSuffix();
  await loginAs(page, SALES);
  await gotoAndSettle(page, `/o/${ORG}/contacts`);

  const buffer = await xlsx([
    ["First name", "Last name", "Email"],
    ["Xlsxa", `One${suffix}`, `xlsxa.${suffix}@example.com`],
    ["Xlsxb", `Two${suffix}`, `xlsxb.${suffix}@example.com`],
  ]);

  await page.getByRole("button", { name: "Import CSV / Excel" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Import contacts from CSV or Excel" });
  await expect(dialog.getByText("Choose a CSV or Excel (.xlsx) file")).toBeVisible();
  await dialog.getByLabel("Contacts CSV file").setInputFiles({
    name: "contacts.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });

  // The sheet is read in the browser, so the column mapping appears at once, pre-filled by header name.
  await expect(dialog.getByText(/2 rows/)).toBeVisible();
  await expect(dialog.getByLabel(/First name/)).toHaveValue("First name");

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/contacts/import") && r.request().method() === "POST"),
    dialog.getByRole("button", { name: /^Import \d+ contacts?$/ }).click(),
  ]);
  expect(response.ok()).toBe(true);
  await expect(dialog.locator(".fb-ct-result__tiles > div").filter({ hasText: "created" })).toContainText("2");
});

test("an Excel file that is not really Excel is explained, not imported", async ({ page }) => {
  await loginAs(page, SALES);
  await gotoAndSettle(page, `/o/${ORG}/contacts`);
  await page.getByRole("button", { name: "Import CSV / Excel" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Import contacts from CSV or Excel" });
  await dialog.getByLabel("Contacts CSV file").setInputFiles({ name: "contacts.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("this is not a workbook") });
  await expect(dialog.getByRole("alert")).toContainText("could not be read");
});

// Sales may download up to 500 rows without the bulk-export right (the CSV has the same rule), and the shared e2e database holds more contacts and
// companies than that. So contacts and companies are narrowed to one fresh record first, the way a person would filter before exporting.
for (const area of ["leads", "contacts", "companies", "deals"] as const) {
  test(`Sales exports ${area} as a PDF`, async ({ page }) => {
    const suffix = uniqueSuffix();
    await loginAs(page, SALES);
    if (area === "contacts") expect((await apiPost(page, `/api/orgs/${ORG_SLUG}/contacts`, { firstName: "Pdfexport", lastName: suffix })).ok()).toBe(true);
    if (area === "companies") expect((await apiPost(page, `/api/orgs/${ORG_SLUG}/companies`, { name: `E2E Pdf Export ${suffix}` })).ok()).toBe(true);
    await gotoAndSettle(page, `/o/${ORG}/${area}`);
    if (area === "contacts" || area === "companies") {
      await page.getByRole("searchbox", { name: `Search ${area}` }).fill(suffix);
      await expect(page.getByText(suffix).first()).toBeVisible();
    }
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export PDF" }).click()]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`^${area}-\\d{4}-\\d{2}-\\d{2}\\.pdf$`));
    const path = await download.path();
    expect(readFileSync(path).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
}
