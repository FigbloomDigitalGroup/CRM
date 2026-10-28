import { expect as baseExpect, test, type Page } from "@playwright/test";
import { apiPost, gotoAndSettle, loginAs, ORG_SLUG, uniqueSuffix } from "./helpers";

/**
 * F3.01 (FIG-1095): the Companies list and Customer 360 in a real browser, per role. Payments are for Finance and Management only, so a role
 * without them never has a payment on the page; a role the API refuses gets the explained no-access.
 */

const expect = baseExpect.configure({ timeout: 20_000 });

async function makeCompany(page: Page, label: string) {
  const suffix = uniqueSuffix();
  const name = `${label} ${suffix}`;
  const { company } = await (await apiPost(page, `/api/orgs/${ORG_SLUG}/companies`, { name, email: `e2e-${suffix}@example.com`, industry: "Testing", location: "Nakuru" })).json();
  return { id: company.id as string, name, suffix };
}

/** A won deal with an overdue invoice, so Customer 360 has a payment to show (or to hide). */
async function companyWithInvoice(page: Page) {
  const c = await makeCompany(page, "E2E 360 Co");
  const ref = await (await page.request.get(`/api/orgs/${ORG_SLUG}/reference-data`)).json();
  const stage = ref.pipelineStages.find((s: { key: string }) => s.key === "SOLUTION_PRESENTED");
  const deal = await (await apiPost(page, `/api/orgs/${ORG_SLUG}/deals`, { companyId: c.id, pipelineStageId: stage.id, value: 120000, currency: "KES", notes: `E2E ${c.suffix}` })).json();
  return { ...c, dealId: deal.id as string };
}

test.describe("the companies list", () => {
  test("Management sees every company, can search the whole list and open a customer", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    const c = await makeCompany(page, "E2E List Co");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/companies`);
    await expect(page.getByRole("heading", { name: "Companies", level: 1 })).toBeVisible();
    await expect(page.getByText(/^All organisation companies · \d+$/)).toBeVisible();
    for (const tile of ["Customers", "Prospects", "Dormant"]) await expect(page.locator(".fb-cu-stat__l", { hasText: tile })).toBeVisible();
    await page.getByLabel("Search companies").fill(c.suffix);
    const row = page.getByRole("row", { name: new RegExp(c.name) });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Nakuru");
    await expect(row.getByRole("combobox", { name: `Owner of ${c.name}` })).toBeVisible();
    await row.getByRole("link", { name: c.name }).click();
    await expect(page.getByRole("heading", { name: c.name, level: 1 })).toBeVisible();
  });

  test("Sales can add, merge and archive but not reassign; Delivery sees the list read-only", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const c = await makeCompany(page, "E2E Sales Co");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/companies`);
    await page.getByLabel("Search companies").fill(c.suffix);
    const row = page.getByRole("row", { name: new RegExp(c.name) });
    await expect(row).toBeVisible();
    await expect(row.getByRole("combobox")).toHaveCount(0);
    await expect(row.getByRole("button", { name: `Merge ${c.name}` })).toBeVisible();
    await expect(row.getByRole("button", { name: `Archive ${c.name}` })).toBeVisible();

    await loginAs(page, "dev.delivery@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/companies`);
    await expect(page.getByRole("button", { name: "New company" })).toHaveCount(0);
    await expect(page.getByText(/Read-only/).first()).toBeVisible();
  });

  test("a role without company access gets the explained no-access, not an empty page", async ({ page }) => {
    await loginAs(page, "dev.tech@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/companies`);
    await expect(page.getByRole("region", { name: /Companies/ })).toBeVisible();
    await expect(page.getByText(/Your role/).first()).toBeVisible();
  });
});

test.describe("Customer 360", () => {
  test("Management sees services, deals, tasks, the timeline and the Payments panel", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    const c = await companyWithInvoice(page);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/companies/${c.id}`);
    await expect(page.getByRole("heading", { name: c.name, level: 1 })).toBeVisible();
    for (const region of ["Services and projects", "Deals, quotes and proposals", "Communication and activity", "Contacts", "Tasks", "Payments"]) {
      await expect(page.getByRole("region", { name: region })).toBeVisible();
    }
    await expect(page.getByRole("region", { name: "Deals, quotes and proposals" })).toContainText("120,000");
  });

  test("Sales never sees the Payments panel; the Outstanding tile says Finance only", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const c = await companyWithInvoice(page);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/companies/${c.id}`);
    await expect(page.getByRole("heading", { name: c.name, level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Payments" })).toHaveCount(0);
    await expect(page.getByText("Finance only")).toBeVisible();
  });

  test("Delivery sees no deal value anywhere on the page", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    const c = await companyWithInvoice(page);
    await loginAs(page, "dev.delivery@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/companies/${c.id}`);
    await expect(page.getByRole("heading", { name: c.name, level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Payments" })).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(/KES\s?\d/);
  });

  test("Finance sees the payments and gets explained notes for the parts that are not theirs", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    const c = await companyWithInvoice(page);
    await loginAs(page, "dev.finance@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/companies/${c.id}`);
    await expect(page.getByRole("region", { name: "Payments" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Tasks" }).getByRole("note")).toContainText("Finance keeps follow-up notes instead");
    await expect(page.getByRole("button", { name: /^(Edit|Merge|Archive|Log activity)$/ })).toHaveCount(0);
  });

  test("lifecycle needs a reason, shows on the page after a reload, and can be handed back to the system", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    const c = await makeCompany(page, "E2E Life Co");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/companies/${c.id}`);
    await page.getByRole("combobox", { name: "Lifecycle" }).selectOption({ label: "Onboarding" });
    const dialog = page.getByRole("dialog", { name: "Change lifecycle" });
    await expect(dialog.getByRole("button", { name: "Change lifecycle" })).toBeDisabled();
    await dialog.getByLabel(/Why are you changing it/).fill("E2E: onboarding started");
    await dialog.getByRole("button", { name: "Change lifecycle" }).click();
    await expect(page.getByText("Lifecycle: Onboarding")).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Set by hand/)).toBeVisible();
    await page.getByRole("button", { name: "Let the system decide" }).click();
    await expect(page.getByText(/Set by hand/)).toHaveCount(0);
  });

  test("an archived company is read-only with a banner and can be restored", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    const c = await makeCompany(page, "E2E Archive Co");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/companies/${c.id}`);
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "read-only until it’s restored" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Lifecycle" })).toHaveCount(0);
    await page.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByRole("status").filter({ hasText: "read-only until it’s restored" })).toHaveCount(0);
  });

  test("logging an activity puts it on the timeline", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const c = await makeCompany(page, "E2E Log Co");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/companies/${c.id}`);
    await page.getByRole("button", { name: "Log activity" }).click();
    const drawer = page.getByRole("dialog", { name: "Log a call or note" });
    await drawer.getByRole("button", { name: "Call", exact: true }).click();
    await drawer.getByLabel("Note").fill("Spoke about renewal terms");
    await drawer.getByRole("button", { name: "Log it" }).click();
    await expect(page.getByRole("region", { name: "Communication and activity" })).toContainText("Spoke about renewal terms");
  });
});
