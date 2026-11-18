import { expect, test, type Page } from "@playwright/test";
import { gotoAndSettle, loginAs, uniqueSuffix } from "./helpers";

/**
 * FIG-801: create -> edit -> merge -> archive for contacts and companies,
 * through the real forms and buttons, as Management (who holds every
 * permission the chain needs). Each record's id is read from the API
 * response the form itself triggered, so the test never depends on list
 * ordering or on what earlier runs left in the shared local database.
 */

async function submitAndCapture(page: Page, urlPart: string, submit: () => Promise<void>, exact = false) {
  const [response] = await Promise.all([
    page.waitForResponse(
      // `exact` matches the collection route itself, not routes under it (the drawer also posts to /companies/check-duplicates while typing).
      (r) => (exact ? new URL(r.url()).pathname === urlPart : r.url().includes(urlPart)) && r.request().method() !== "GET",
    ),
    submit(),
  ]);
  expect(response.ok()).toBe(true);
  return response.json();
}

test("contact: create -> edit -> merge -> archive", async ({ page }) => {
  const suffix = uniqueSuffix();
  await loginAs(page, "dev.management@figbloom.local");

  const keeper = { first: "E2EKeeper", last: suffix };
  const dupe = { first: "E2EDupe", last: suffix };
  const ids: Record<string, string> = {};

  await test.step("create two contacts through the drawer", async () => {
    for (const person of [keeper, dupe]) {
      await gotoAndSettle(page, "/o/figbloom/contacts");
      await page.getByRole("button", { name: "New contact" }).first().click();
      const drawer = page.getByRole("dialog", { name: "New contact" });
      await drawer.getByLabel(/First name/).fill(person.first);
      await drawer.getByLabel("Last name").fill(person.last);
      await drawer.getByLabel("Email").fill(`${person.first}.${suffix}@example.com`.toLowerCase());
      const body = await submitAndCapture(page, "/api/orgs/figbloom/contacts", () =>
        drawer.getByRole("button", { name: "Create contact" }).click(),
      );
      ids[person.first] = body.contact.id;
      // Creating opens the new contact's page.
      await expect(page.getByRole("heading", { name: `${person.first} ${person.last}`, level: 1 })).toBeVisible();
    }
  });

  await test.step("edit the duplicate's job title and see it persist", async () => {
    await gotoAndSettle(page, `/o/figbloom/contacts/${ids[dupe.first]}`);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Edit contact" });
    await drawer.getByLabel("Job title").fill("Head of E2E");
    await submitAndCapture(page, `/contacts/${ids[dupe.first]}`, () => drawer.getByRole("button", { name: "Save changes" }).click());
    await page.reload();
    await expect(page.getByRole("region", { name: "Details" }).or(page.getByText("Head of E2E")).first()).toBeVisible();
    await expect(page.getByText("Head of E2E").first()).toBeVisible();
  });

  await test.step("merge the duplicate into the keeper", async () => {
    await page.getByRole("button", { name: "Merge", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Merge duplicates" });
    await dialog.getByRole("searchbox", { name: "Search for the duplicate contact" }).fill(`${keeper.first} ${keeper.last}`);
    await dialog.getByRole("button", { name: new RegExp(`${keeper.first} ${keeper.last}`) }).first().click();
    // This page's record is kept to start with; keep the other one so the duplicate is the one archived.
    await dialog.getByRole("button", { name: /POSSIBLE DUPLICATE/ }).click();
    await submitAndCapture(page, `/contacts/${ids[dupe.first]}/merge`, () => dialog.getByRole("button", { name: "Merge into selected" }).click());
    // The sheet becomes the "Merged" confirmation (with Undo merge) once the merge is saved.
    const merged = page.getByRole("dialog", { name: "Merged" });
    await expect(merged).toBeVisible();
    await merged.getByRole("button", { name: "Done" }).click();
    // The merged-away record is archived, not deleted.
    await gotoAndSettle(page, `/o/figbloom/contacts/${ids[dupe.first]}`);
    await expect(page.getByText(/Everything on this contact is read-only until it’s restored/)).toBeVisible();
  });

  await test.step("archive the keeper, then restore it", async () => {
    await gotoAndSettle(page, `/o/figbloom/contacts/${ids[keeper.first]}`);
    await submitAndCapture(page, `/contacts/${ids[keeper.first]}/archive`, () =>
      page.getByRole("button", { name: "Archive", exact: true }).click(),
    );
    await expect(page.getByText(/Everything on this contact is read-only until it’s restored/)).toBeVisible();
    await submitAndCapture(page, `/contacts/${ids[keeper.first]}/restore`, () =>
      page.getByRole("button", { name: "Restore" }).click(),
    );
    await expect(page.getByText(/Everything on this contact is read-only until it’s restored/)).toHaveCount(0);
  });
});

test("company: create -> edit -> merge -> archive", async ({ page }) => {
  const suffix = uniqueSuffix();
  await loginAs(page, "dev.management@figbloom.local");

  const keeper = `E2E Keeper Co ${suffix}`;
  const dupe = `E2E Dupe Co ${suffix}`;
  const ids: Record<string, string> = {};

  await test.step("create two companies through the drawer", async () => {
    for (const name of [keeper, dupe]) {
      await gotoAndSettle(page, "/o/figbloom/companies");
      await page.getByRole("button", { name: "New company" }).first().click();
      const drawer = page.getByRole("dialog", { name: "New company" });
      await drawer.getByLabel(/Company name/).fill(name);
      await drawer.getByLabel("Industry").fill("Testing");
      const body = await submitAndCapture(page, "/api/orgs/figbloom/companies", () => drawer.getByRole("button", { name: "Add company" }).click(), true);
      ids[name] = body.company.id;
      // Creating opens the new company's page.
      await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    }
  });

  await test.step("edit the duplicate's industry and see it persist", async () => {
    await gotoAndSettle(page, `/o/figbloom/companies/${ids[dupe]}`);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Edit company" });
    await drawer.getByLabel("Industry").fill("Quality Assurance");
    await submitAndCapture(page, `/companies/${ids[dupe]}`, () => drawer.getByRole("button", { name: "Save changes" }).click());
    await page.reload();
    await expect(page.getByText("Quality Assurance").first()).toBeVisible();
  });

  await test.step("merge the duplicate into the keeper", async () => {
    await page.getByRole("button", { name: "Merge", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Merge duplicates" });
    await dialog.getByRole("searchbox", { name: "Search for the duplicate company" }).fill(keeper);
    await dialog.getByRole("button", { name: new RegExp(keeper) }).first().click();
    // This page's record is kept to start with; keep the other one so the duplicate is the one archived.
    await dialog.getByRole("button", { name: /POSSIBLE DUPLICATE/ }).click();
    await submitAndCapture(page, `/companies/${ids[dupe]}/merge`, () => dialog.getByRole("button", { name: "Merge into selected" }).click());
    await expect(page.getByRole("dialog", { name: "Merged" })).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    // The merged-away record is archived, not deleted.
    await gotoAndSettle(page, `/o/figbloom/companies/${ids[dupe]}`);
    await expect(page.getByText(/Everything on this customer is read-only until it’s restored/)).toBeVisible();
  });

  await test.step("archive the keeper, then restore it", async () => {
    await gotoAndSettle(page, `/o/figbloom/companies/${ids[keeper]}`);
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await submitAndCapture(page, `/companies/${ids[keeper]}/archive`, () => page.getByRole("dialog").getByRole("button", { name: "Archive", exact: true }).click());
    await expect(page.getByText(/Everything on this customer is read-only until it’s restored/)).toBeVisible();
    await submitAndCapture(page, `/companies/${ids[keeper]}/restore`, () => page.getByRole("button", { name: "Restore" }).click());
    await expect(page.getByText(/Everything on this customer is read-only until it’s restored/)).toHaveCount(0);
  });
});
