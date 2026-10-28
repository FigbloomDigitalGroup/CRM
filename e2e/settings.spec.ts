import { expect, test } from "@playwright/test";
import { gotoAndSettle, loginAs, uniqueSuffix } from "./helpers";

/**
 * FIG-801 and M9 (F4.04, FIG-1106): the Settings flows as Management: invite a member, change their role, cancel the invite, and add, rename, hide
 * and show a reference value. Everything created carries a unique suffix, so reruns against the same local database never collide. (Rewritten for
 * the redesigned Settings; the flows are the same, the controls are the design's.)
 */
test("invite a member, change their role, and cancel the invite", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `e2e.invitee.${suffix}@example.com`;
  await loginAs(page, "dev.management@figbloom.local");

  await test.step("invite a member", async () => {
    await gotoAndSettle(page, "/o/figbloom/settings?tab=members");
    const form = page.getByRole("form", { name: "Invite a member" });
    await form.getByLabel("Name").fill(`E2E Invitee ${suffix}`);
    await form.getByLabel("Email").fill(email);
    await form.getByLabel("Role").selectOption({ label: "Sales" });
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/orgs/figbloom/memberships") && r.request().method() === "POST"),
      form.getByRole("button", { name: "Send invite" }).click(),
    ]);
    expect(response.ok()).toBe(true);
    await expect(page.getByRole("status").filter({ hasText: `Invite sent to ${email}.` }).first()).toBeVisible();
    const row = page.getByRole("row", { name: new RegExp(email) });
    await expect(row).toContainText("Invited");
    await expect(row.getByRole("button", { name: "Resend invite" })).toBeVisible();
  });

  await test.step("change the invited member's role", async () => {
    const row = page.getByRole("row", { name: new RegExp(email) });
    const [response] = await Promise.all([
      page.waitForResponse((r) => /\/memberships\/.+\/role$/.test(r.url()) && r.request().method() === "POST"),
      row.getByRole("combobox").selectOption({ label: "Delivery" }),
    ]);
    expect(response.ok()).toBe(true);
    await page.reload();
    await expect(page.getByRole("row", { name: new RegExp(email) }).getByRole("combobox")).toHaveValue("DELIVERY");
  });

  await test.step("cancel the invite", async () => {
    const row = page.getByRole("row", { name: new RegExp(email) });
    await row.getByRole("button", { name: "Cancel invite" }).click();
    const [response] = await Promise.all([
      page.waitForResponse((r) => /\/memberships\/.+\/remove$/.test(r.url()) && r.request().method() === "POST"),
      page.getByRole("dialog", { name: "Cancel this invite?" }).getByRole("button", { name: "Cancel invite" }).click(),
    ]);
    expect(response.ok()).toBe(true);
    await expect(page.getByRole("row", { name: new RegExp(email) })).toContainText("Removed");
  });
});

test("add a lead source, rename it, hide it, then show it again", async ({ page }) => {
  const suffix = uniqueSuffix();
  const name = `E2E Source ${suffix}`;
  const renamed = `${name} renamed`;
  await loginAs(page, "dev.management@figbloom.local");
  await gotoAndSettle(page, "/o/figbloom/settings?tab=ref");

  await test.step("add", async () => {
    await page.getByLabel("Add item").fill(name);
    const [added] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/reference-admin/leadSources") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Add", exact: true }).click(),
    ]);
    expect(added.ok()).toBe(true);
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  });

  await test.step("rename", async () => {
    await page.getByRole("button", { name: `Edit ${name}` }).click();
    const dialog = page.getByRole("dialog", { name: `Edit ${name}` });
    await dialog.getByLabel("Name").fill(renamed);
    const [saved] = await Promise.all([
      page.waitForResponse((r) => /reference-admin\/leadSources\/.+/.test(r.url()) && r.request().method() === "PATCH"),
      dialog.getByRole("button", { name: "Save" }).click(),
    ]);
    expect(saved.ok()).toBe(true);
    await expect(page.getByText(renamed, { exact: true })).toBeVisible();
  });

  await test.step("hide, then show again", async () => {
    await page.getByRole("button", { name: `Hide ${renamed}` }).click();
    await expect(page.getByRole("button", { name: `Show ${renamed}` })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: `Show ${renamed}` })).toBeVisible();
    await page.getByRole("button", { name: `Show ${renamed}` }).click();
    await expect(page.getByRole("button", { name: `Hide ${renamed}` })).toBeVisible();
  });

  await test.step("an unused value can be deleted; the system's own values cannot be hidden", async () => {
    await page.getByRole("button", { name: `Delete ${renamed}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(renamed, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Hide Website" })).toHaveAttribute("aria-disabled", "true");
  });
});
