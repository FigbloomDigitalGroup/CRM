import { expect, test, type Page } from "@playwright/test";
import { gotoAndSettle, loginAs, uniqueSuffix } from "./helpers";

/**
 * FIG-801: create -> edit -> merge -> archive for contacts and companies,
 * through the real forms and buttons, as Management (who holds every
 * permission the chain needs). Each record's id is read from the API
 * response the form itself triggered, so the test never depends on list
 * ordering or on what earlier runs left in the shared local database.
 */

async function submitAndCapture(page: Page, urlPart: string, submit: () => Promise<void>) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(urlPart) && r.request().method() !== "GET",
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

  await test.step("create two contacts through the form", async () => {
    for (const person of [keeper, dupe]) {
      await gotoAndSettle(page, "/o/figbloom/contacts");
      await page.getByLabel("First name").fill(person.first);
      await page.getByLabel("Last name").fill(person.last);
      await page.getByLabel("Email").fill(`${person.first}.${suffix}@example.com`.toLowerCase());
      const body = await submitAndCapture(page, "/api/orgs/figbloom/contacts", () =>
        page.getByRole("button", { name: "Create contact" }).click(),
      );
      ids[person.first] = body.contact.id;
      await expect(page.getByText(`Added ${person.first} ${person.last}.`)).toBeVisible();
    }
  });

  await test.step("edit the duplicate's job title and see it persist", async () => {
    await gotoAndSettle(page, `/o/figbloom/contacts/${ids[dupe.first]}`);
    const form = page.locator("form.lead-edit-form");
    await form.locator(".lead-edit-field", { hasText: "Job title" }).locator("input").fill("Head of E2E");
    await submitAndCapture(page, `/contacts/${ids[dupe.first]}`, () => form.getByRole("button", { name: "Save changes" }).click());
    await page.reload();
    await expect(page.locator("dl.detail-grid").getByText("Head of E2E")).toBeVisible();
  });

  await test.step("merge the duplicate into the keeper (two-click confirm)", async () => {
    const merge = page.locator("#merge");
    await merge.locator("select").selectOption({ label: `${keeper.first} ${keeper.last}` });
    await merge.getByRole("button", { name: "Merge into selected" }).click();
    await submitAndCapture(page, `/contacts/${ids[dupe.first]}/merge`, () =>
      merge.getByRole("button", { name: /Confirm merge/ }).click(),
    );
    // The merged-away record is archived, not deleted.
    await expect(page.getByText("This contact is archived.")).toBeVisible();
  });

  await test.step("archive the keeper, then restore it", async () => {
    await gotoAndSettle(page, `/o/figbloom/contacts/${ids[keeper.first]}`);
    await submitAndCapture(page, `/contacts/${ids[keeper.first]}/archive`, () =>
      page.getByRole("button", { name: "Archive", exact: true }).click(),
    );
    await expect(page.getByText("This contact is archived.")).toBeVisible();
    await submitAndCapture(page, `/contacts/${ids[keeper.first]}/restore`, () =>
      page.getByRole("button", { name: "Restore" }).click(),
    );
    await expect(page.getByText("This contact is archived.")).toHaveCount(0);
  });
});

test("company: create -> edit -> merge -> archive", async ({ page }) => {
  const suffix = uniqueSuffix();
  await loginAs(page, "dev.management@figbloom.local");

  const keeper = `E2E Keeper Co ${suffix}`;
  const dupe = `E2E Dupe Co ${suffix}`;
  const ids: Record<string, string> = {};

  await test.step("create two companies through the form", async () => {
    for (const name of [keeper, dupe]) {
      await gotoAndSettle(page, "/o/figbloom/companies");
      await page.getByLabel("Name", { exact: true }).fill(name);
      await page.getByLabel("Industry").fill("Testing");
      const body = await submitAndCapture(page, "/api/orgs/figbloom/companies", () =>
        page.getByRole("button", { name: /Create company/ }).click(),
      );
      ids[name] = body.company.id;
    }
  });

  await test.step("edit the duplicate's industry and see it persist", async () => {
    await gotoAndSettle(page, `/o/figbloom/companies/${ids[dupe]}`);
    const form = page.locator("form.lead-edit-form");
    await form.locator(".lead-edit-field", { hasText: "Industry" }).locator("input").fill("Quality Assurance");
    await submitAndCapture(page, `/companies/${ids[dupe]}`, () => form.getByRole("button", { name: "Save changes" }).click());
    await page.reload();
    await expect(page.locator("dl.detail-grid").getByText("Quality Assurance")).toBeVisible();
  });

  await test.step("merge the duplicate into the keeper", async () => {
    const merge = page.locator("#merge");
    await merge.locator("select").selectOption({ label: keeper });
    await merge.getByRole("button", { name: "Merge into selected" }).click();
    await submitAndCapture(page, `/companies/${ids[dupe]}/merge`, () =>
      merge.getByRole("button", { name: /Confirm merge/ }).click(),
    );
    await expect(page.getByText("This company is archived.")).toBeVisible();
  });

  await test.step("archive the keeper, then restore it", async () => {
    await gotoAndSettle(page, `/o/figbloom/companies/${ids[keeper]}`);
    await submitAndCapture(page, `/companies/${ids[keeper]}/archive`, () =>
      page.getByRole("button", { name: "Archive", exact: true }).click(),
    );
    await expect(page.getByText("This company is archived.")).toBeVisible();
    await submitAndCapture(page, `/companies/${ids[keeper]}/restore`, () =>
      page.getByRole("button", { name: "Restore" }).click(),
    );
    await expect(page.getByText("This company is archived.")).toHaveCount(0);
  });
});
