import { expect, test, type Page } from "@playwright/test";
import { apiPost, gotoAndSettle, loginAs, ORG_SLUG, uniqueSuffix } from "./helpers";

/**
 * F3.04: the Conversations hub in a real browser, per role. A message from an unknown sender is logged through the API (the same call the
 * "Log a conversation" dialog makes), then linked to a record or turned into a lead from the Needs-linking queue in two steps.
 * Written against the seeded organisation; not yet run (needs the database and a built app).
 */

async function openHub(page: Page) {
  await gotoAndSettle(page, `/o/${ORG_SLUG}/conversations`);
  await expect(page.getByRole("heading", { level: 1, name: "Conversations" })).toBeVisible();
}

async function logUnknown(page: Page, name: string) {
  const res = await apiPost(page, `/api/orgs/${ORG_SLUG}/conversations`, {
    channel: "EMAIL",
    direction: "INBOUND",
    subject: `Quote request ${name}`,
    summary: "We would like a quote for six cameras.",
    counterpartyName: name,
    counterpartyEmail: `${name.toLowerCase().replace(/\s+/g, ".")}@example.test`,
  });
  expect(res.ok()).toBeTruthy();
}

const digits = () => uniqueSuffix().replace(/\D/g, "").slice(-6);

test.describe("Conversations hub", () => {
  test("Management sees the whole organisation and the Needs-linking queue", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await openHub(page);
    await expect(page.getByText("All organisation conversations")).toBeVisible();
    await expect(page.getByRole("tab", { name: /Needs linking/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Log a conversation" })).toBeVisible();
  });

  test("an unlinked message becomes a lead in two steps", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const name = `Zuri E2E${digits()}`;
    await logUnknown(page, name);
    await openHub(page);
    const queueRow = page.locator(".fb-en-qrow", { hasText: name });
    await expect(queueRow).toBeVisible();
    await queueRow.getByRole("button", { name: "Create lead" }).click();
    const dialog = page.getByRole("dialog", { name: /Create a lead from this message|This looks like someone/ });
    await dialog.getByRole("button", { name: /Create lead|Create anyway/ }).click();
    await expect(page.getByText(/Lead created for/)).toBeVisible();
    await expect(page.locator(".fb-en-qrow", { hasText: name })).toHaveCount(0);
  });

  test("an unlinked message links to an existing record: choose, then confirm", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    const name = `Link E2E${digits()}`;
    await logUnknown(page, name);
    await openHub(page);
    const queueRow = page.locator(".fb-en-qrow", { hasText: name });
    await queueRow.getByRole("button", { name: /to a record/ }).click();
    const dialog = page.getByRole("dialog", { name: "Link to an existing record" });
    await dialog.getByRole("option").first().click();
    await page.getByRole("dialog", { name: "Link this message?" }).getByRole("button", { name: "Link" }).click();
    await expect(page.getByText(/^Linked to /)).toBeVisible();
    await expect(page.locator(".fb-en-qrow", { hasText: name })).toHaveCount(0);
  });

  test("the channel filter is kept when the page is reloaded", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await openHub(page);
    await page.getByRole("tab", { name: /Email/ }).click();
    await page.reload();
    await expect(page.getByRole("tab", { name: /Email/ })).toHaveAttribute("aria-selected", "true");
  });

  test("Delivery reads the queue but cannot act, and is told why", async ({ page }) => {
    await loginAs(page, "dev.delivery@figbloom.local");
    await openHub(page);
    await expect(page.getByText(/is for Sales and Management/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Log a conversation" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create lead" })).toHaveCount(0);
  });

  test("Restricted Technical never gets a way to log or link", async ({ page }) => {
    await loginAs(page, "dev.tech@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/conversations`);
    await expect(page.getByRole("button", { name: "Log a conversation" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create lead" })).toHaveCount(0);
  });
});
