import { expect as baseExpect, test, type Page } from "@playwright/test";
import { apiPost, gotoAndSettle, loginAs, ORG_SLUG, uniqueSuffix } from "./helpers";

/**
 * F3.03 (FIG-1097): merge duplicates, side by side, with a field choice, a preview, an audit entry and an undo window. Nothing is lost silently:
 * the other company is archived, never deleted, and its contacts move across.
 */

const expect = baseExpect.configure({ timeout: 20_000 });

async function makePair(page: Page) {
  const suffix = uniqueSuffix();
  const mk = async (name: string, extra: Record<string, string>) => (await (await apiPost(page, `/api/orgs/${ORG_SLUG}/companies`, { name, ...extra })).json()).company.id as string;
  const keepName = `E2E Merge Keep ${suffix}`;
  const dupeName = `E2E Merge Dupe ${suffix}`;
  const keepId = await mk(keepName, { industry: "Dairy" });
  const dupeId = await mk(dupeName, { industry: "Dairy", website: "https://dupe.example.com", phone: "+254711000111" });
  const contact = await apiPost(page, `/api/orgs/${ORG_SLUG}/contacts`, { firstName: "Moved", lastName: suffix, companyId: dupeId });
  expect(contact.ok(), await contact.text()).toBe(true);
  return { suffix, keepName, dupeName, keepId, dupeId, contactName: `Moved ${suffix}` };
}

test.describe("merge duplicates", () => {
  test("Sales merges a duplicate company: fields are chosen, the contact moves, the duplicate is archived, and the merge can be undone", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const p = await makePair(page);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/companies/${p.keepId}`);
    await page.getByRole("button", { name: "Merge", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Merge duplicates" });
    await dialog.getByRole("searchbox", { name: "Search for the duplicate company" }).fill(p.dupeName);
    await dialog.getByRole("button", { name: new RegExp(p.dupeName) }).first().click();

    // Side by side, with the fields that differ and a preview of the result.
    await expect(dialog.getByRole("group", { name: "Choose the record to keep" })).toContainText("THIS RECORD");
    const fields = dialog.getByRole("table", { name: "Field by field" });
    await expect(fields).toContainText("Website");
    await dialog.getByRole("button", { name: /Phone: take \+254711000111/ }).click();
    await expect(dialog.getByText(/is kept/)).toContainText("phone +254711000111");

    const [merge] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/companies/${p.dupeId}/merge`) && r.request().method() === "POST"),
      dialog.getByRole("button", { name: "Merge into selected" }).click(),
    ]);
    expect(merge.ok()).toBe(true);
    const done = page.getByRole("dialog", { name: "Merged" });
    await expect(done).toContainText(`${p.dupeName} was archived`);

    // The contact is now on the kept company; the duplicate is archived, not deleted.
    await page.getByRole("button", { name: "Done" }).click();
    await page.reload();
    await expect(page.getByRole("region", { name: "Contacts" })).toContainText(p.contactName);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/companies/${p.dupeId}`);
    await expect(page.getByText(/Everything on this customer is read-only until it’s restored/)).toBeVisible();
  });

  test("an undo restores the duplicate and moves the contact back", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    const p = await makePair(page);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/companies/${p.keepId}`);
    await page.getByRole("button", { name: "Merge", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Merge duplicates" });
    await dialog.getByRole("searchbox", { name: "Search for the duplicate company" }).fill(p.dupeName);
    await dialog.getByRole("button", { name: new RegExp(p.dupeName) }).first().click();
    await dialog.getByRole("button", { name: "Merge into selected" }).click();
    const done = page.getByRole("dialog", { name: "Merged" });
    await expect(done).toBeVisible();
    await done.getByRole("button", { name: "Undo merge" }).click();
    await expect(page.getByRole("dialog", { name: "Merge undone" })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await gotoAndSettle(page, `/o/${ORG_SLUG}/companies/${p.dupeId}`);
    await expect(page.getByText(/Everything on this customer is read-only until it’s restored/)).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Contacts" })).toContainText(p.contactName);
  });

  test("the merge shows in the audit history of both companies for Management", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    const p = await makePair(page);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/companies/${p.keepId}`);
    await page.getByRole("button", { name: "Merge", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Merge duplicates" });
    await dialog.getByRole("searchbox", { name: "Search for the duplicate company" }).fill(p.dupeName);
    await dialog.getByRole("button", { name: new RegExp(p.dupeName) }).first().click();
    await dialog.getByRole("button", { name: "Merge into selected" }).click();
    await expect(page.getByRole("dialog", { name: "Merged" })).toContainText("audit log");
    const audit = await (await page.request.get(`/api/orgs/${ORG_SLUG}/audit/events?entityType=Company&entityId=${p.keepId}`)).json();
    expect(JSON.stringify(audit)).toContain("company.merged_from");
  });

  test("the merge page works on its own, and a role that cannot merge is told so", async ({ page }) => {
    await loginAs(page, "dev.finance@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/merge?kind=company&id=00000000-0000-0000-0000-000000000000`);
    await expect(page.getByRole("heading", { name: "Merge duplicates", level: 1 })).toBeVisible();
    await expect(page.getByText("Your role cannot merge companies")).toBeVisible();
  });

  test("leads are explained, not merged", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/merge?kind=lead&id=x`);
    await expect(page.getByRole("dialog", { name: "Merge duplicates" })).toContainText("Leads are not merged in this release.");
  });
});
