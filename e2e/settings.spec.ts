import { expect, test } from "@playwright/test";
import { gotoAndSettle, loginAs, uniqueSuffix } from "./helpers";

/**
 * FIG-801: the Settings flows -- invite a member, change their role, edit a
 * reference catalog -- as Management. Everything created carries a unique
 * suffix, so reruns against the same local database never collide.
 */
test("invite a member, change their role, and edit a catalog entry", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `e2e.invitee.${suffix}@example.com`;
  await loginAs(page, "dev.management@figbloom.local");

  await test.step("invite a member", async () => {
    await gotoAndSettle(page, "/o/figbloom/settings");
    const inviteForm = page.locator("form", {
      has: page.getByRole("button", { name: "Send invite" }),
    });
    await inviteForm.getByLabel("Name").fill(`E2E Invitee ${suffix}`);
    await inviteForm.getByLabel("Email").fill(email);
    await inviteForm.getByLabel("Role").selectOption({ label: "Sales" });
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/orgs/figbloom/memberships") &&
          r.request().method() === "POST",
      ),
      inviteForm.getByRole("button", { name: "Send invite" }).click(),
    ]);
    expect(response.ok()).toBe(true);
    await expect(page.getByText(`Invite sent to ${email}.`)).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(email) })).toContainText("PENDING");
  });

  await test.step("change the invited member's role", async () => {
    const row = page.getByRole("row", { name: new RegExp(email) });
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => /\/memberships\/.+\/role$/.test(r.url()) && r.request().method() === "POST",
      ),
      row.locator("select").selectOption({ label: "Delivery" }),
    ]);
    expect(response.ok()).toBe(true);
    await page.reload();
    await expect(
      page.getByRole("row", { name: new RegExp(email) }).locator("select"),
    ).toHaveValue("DELIVERY");
  });

  await test.step("add a lead source, rename it, then deactivate it", async () => {
    const name = `E2E Source ${suffix}`;
    const renamed = `${name} renamed`;
    // Each CatalogEditor is one <div> holding its table and its "Add ..." form;
    // the innermost div containing the "Add lead source" heading is this one.
    const catalog = page
      .locator("div", { has: page.getByRole("heading", { name: "Add lead source" }) })
      .last();
    await catalog.getByLabel("Name", { exact: true }).fill(name);
    const [added] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes("/reference-catalogs/leadSources") && r.request().method() === "POST",
      ),
      catalog.getByRole("button", { name: "Add", exact: true }).click(),
    ]);
    expect(added.ok()).toBe(true);

    let row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Edit" }).click();
    await row.locator("input").first().fill(renamed);
    const [saved] = await Promise.all([
      page.waitForResponse(
        (r) =>
          /reference-catalogs\/leadSources\/.+/.test(r.url()) && r.request().method() === "POST",
      ),
      row.getByRole("button", { name: "Save" }).click(),
    ]);
    expect(saved.ok()).toBe(true);

    row = page.getByRole("row", { name: new RegExp(renamed) });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Deactivate" }).click();
    await expect(row).toContainText("Inactive");
  });
});
