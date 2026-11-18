import { expect as baseExpect, test, type Page } from "@playwright/test";
import { apiPost, gotoAndSettle, loginAs, ORG_SLUG, uniqueSuffix } from "./helpers";

/**
 * F3.02 (FIG-1096): the contacts list and a contact's page in a real browser, per role, and the call and WhatsApp log prompt. Each test makes
 * its own contact through the API and finds it by name, so it never depends on what other runs left in the shared database.
 */

const expect = baseExpect.configure({ timeout: 20_000 });

async function makeContact(page: Page, over: Record<string, unknown> = {}) {
  const suffix = uniqueSuffix();
  const body = { firstName: "E2EReach", lastName: suffix, phone: "0712345678", email: `e2e-reach-${suffix}@example.com`, ...over };
  const res = await apiPost(page, `/api/orgs/${ORG_SLUG}/contacts`, body);
  expect(res.ok(), await res.text()).toBe(true);
  const { contact } = await res.json();
  return { id: contact.id as string, name: `${body.firstName} ${body.lastName}`, first: body.firstName as string, suffix };
}

/** The phone app takes the tab away and the person returns: what the browser reports after a call or a WhatsApp chat. */
async function leaveAndReturn(page: Page) {
  await page.evaluate(() => {
    const set = (state: string) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    set("hidden");
    set("visible");
  });
}

test.describe("the contacts list", () => {
  test("Sales sees the shared list, filters it, and finds a standalone contact", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const person = await makeContact(page, { phone: undefined, email: undefined });
    await gotoAndSettle(page, `/o/${ORG_SLUG}/contacts`);
    await expect(page.getByRole("heading", { name: "Contacts", level: 1 })).toBeVisible();
    await expect(page.getByText(/^Shared list · \d+$/)).toBeVisible();
    await expect(page.getByRole("tab", { name: /My contacts/ })).toBeVisible();

    await page.getByRole("tab", { name: /No company/ }).click();
    await page.getByRole("searchbox", { name: "Search contacts" }).fill(person.suffix);
    const row = page.getByRole("row", { name: new RegExp(person.name) });
    await expect(row).toBeVisible();
    await expect(row.getByText("No company")).toBeVisible();
    // No phone, so no dead Call or WhatsApp buttons.
    await expect(row.getByRole("link", { name: /^Call / })).toHaveCount(0);

    await page.getByRole("tab", { name: /Missing email/ }).click();
    await expect(page.getByRole("row", { name: new RegExp(person.name) })).toBeVisible();
  });

  test("Management can import and export; Finance can view but not create, import or reach", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/contacts`);
    await expect(page.getByText(/^All organisation contacts · \d+$/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Import CSV" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New contact" })).toBeVisible();

    await page.context().clearCookies();
    await loginAs(page, "dev.finance@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/contacts`);
    await expect(page.getByText(/^Read-only · \d+$/)).toBeVisible();
    await expect(page.getByRole("button", { name: "New contact" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Import CSV" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Call / })).toHaveCount(0);
  });

  test("Restricted Technical gets the explained no-access page", async ({ page }) => {
    await loginAs(page, "dev.tech@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/contacts`);
    await expect(page.getByRole("region", { name: /Contacts/ }).filter({ hasText: /Your role|ask/i }).first()).toBeVisible();
  });
});

test.describe("call and WhatsApp, then the log prompt", () => {
  test("Sales taps Call, comes back, and logs it in two taps; it shows on the contact's page", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const person = await makeContact(page);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/contacts/${person.id}`);
    await expect(page.getByRole("heading", { name: person.name, level: 1 })).toBeVisible();

    const call = page.getByRole("link", { name: new RegExp(`^Call ${person.first}`) });
    await expect(call).toHaveAttribute("href", /^tel:\+2547/);
    // Stop the browser from really leaving for the phone app; the prompt waits for the return, which the test simulates.
    await call.evaluate((a) => a.addEventListener("click", (e) => e.preventDefault()));
    await call.click();
    await leaveAndReturn(page);

    const dialog = page.getByRole("dialog", { name: "How did it go?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Reached" }).click();
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/quick-log") && r.request().method() === "POST"),
      dialog.getByRole("button", { name: "Log it" }).click(),
    ]);
    expect(response.ok()).toBe(true);
    await expect(dialog).toHaveCount(0);

    await page.reload();
    const convo = page.getByRole("region", { name: "Recent conversations" });
    await expect(convo.getByText(/Call/).first()).toBeVisible();
  });

  test("WhatsApp is logged as WhatsApp with a next action that becomes a task", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const person = await makeContact(page);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/contacts/${person.id}`);
    const wa = page.getByRole("link", { name: "Open WhatsApp" });
    await wa.evaluate((a) => a.addEventListener("click", (e) => e.preventDefault()));
    await wa.click();
    await leaveAndReturn(page);
    const dialog = page.getByRole("dialog", { name: "How did it go?" });
    await expect(dialog.getByText(`WhatsApp with ${person.first}`)).toBeVisible();
    await dialog.getByRole("button", { name: "Left a message" }).click();
    await dialog.getByLabel("Next action").fill("Send the brochure");
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/quick-log") && r.request().method() === "POST"),
      dialog.getByRole("button", { name: "Log it" }).click(),
    ]);
    const logged = await response.json();
    expect(logged.taskId).toBeTruthy();
    await page.reload();
    await expect(page.getByRole("region", { name: "Tasks" }).getByText("Send the brochure")).toBeVisible();
  });

  test("Skip logs nothing", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const person = await makeContact(page);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/contacts/${person.id}`);
    const call = page.getByRole("link", { name: new RegExp(`^Call ${person.first}`) });
    await call.evaluate((a) => a.addEventListener("click", (e) => e.preventDefault()));
    await call.click();
    await leaveAndReturn(page);
    await page.getByRole("dialog", { name: "How did it go?" }).getByRole("button", { name: "Skip" }).click();
    await expect(page.getByRole("dialog", { name: "How did it go?" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("No conversations logged yet.")).toBeVisible();
  });

  test("Delivery may reach a contact but cannot edit it", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const person = await makeContact(page);
    await page.context().clearCookies();
    await loginAs(page, "dev.delivery@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/contacts/${person.id}`);
    await expect(page.getByRole("heading", { name: person.name, level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(`^Call ${person.first}`) })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Archive", exact: true })).toHaveCount(0);
  });
});
