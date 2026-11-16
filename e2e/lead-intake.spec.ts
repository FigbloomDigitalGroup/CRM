import { expect, test } from "@playwright/test";
import { gotoAndSettle, loginAs, ORG_SLUG, uniqueSuffix } from "./helpers";

/** FIG-1675 (P2-21): a new lead with email, company and the person's role also appears in Contacts and Companies. */

test("Sales adds a lead with email, company and role, and finds the contact and the company", async ({ page }) => {
  const suffix = uniqueSuffix();
  const company = `Intake Hotels ${suffix}`;
  const email = `amara.${suffix}@intake.example`.toLowerCase();
  await loginAs(page, "dev.sales@figbloom.local");
  await gotoAndSettle(page, `/o/${ORG_SLUG}/leads`);
  await page.getByRole("button", { name: /New lead/ }).first().click();
  const dialog = page.getByRole("dialog", { name: "New lead" });
  await dialog.getByRole("combobox", { name: /Company or person/ }).fill(`Amara Osei ${suffix}`);
  await dialog.getByRole("textbox", { name: "Email" }).fill(email);
  await dialog.getByRole("combobox", { name: /^Company(?! or)/ }).fill(company);
  await dialog.getByRole("combobox", { name: /Role in the company/ }).fill("Procurement manager");
  await dialog.getByRole("button", { name: /Create lead/ }).click();
  await expect(dialog).toBeHidden();

  await gotoAndSettle(page, `/o/${ORG_SLUG}/contacts`);
  await page.getByRole("searchbox").first().fill(email).catch(() => undefined);
  await expect(page.getByText(`Amara`).first()).toBeVisible();
  const contacts = await page.request.get(`/api/orgs/${ORG_SLUG}/contacts?q=${encodeURIComponent(email)}`);
  const items = (await contacts.json()).items as { email: string; jobTitle: string | null }[];
  expect(items.filter((c) => c.email === email)).toHaveLength(1);
  expect(items[0].jobTitle).toBe("Procurement manager");

  await gotoAndSettle(page, `/o/${ORG_SLUG}/companies`);
  const companies = await page.request.get(`/api/orgs/${ORG_SLUG}/companies?q=${encodeURIComponent(company)}`);
  expect(((await companies.json()).items as { name: string }[]).some((c) => c.name === company)).toBe(true);
});
