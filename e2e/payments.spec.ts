import { expect as baseExpect, test, type Page } from "@playwright/test";
import { apiPost, gotoAndSettle, loginAs, ORG_SLUG, uniqueSuffix } from "./helpers";

/**
 * F3.06 (FIG-1100): the Payments tracker, in a real browser, per role. Written for the lead's single e2e run; each test makes its own won deal
 * and invoice through the API so it can find them by name. Payments are Finance and Management only: every other role gets the explained
 * no-access page and never sees an amount.
 */

const expect = baseExpect.configure({ timeout: 20_000 });

/** Signs in as another account on the same page: the old session is dropped first so the sign-in page is not skipped. */
async function signInAs(page: Page, email: string) {
  await page.context().clearCookies();
  await loginAs(page, email);
}

async function originOf(page: Page) {
  return new URL(page.url() === "about:blank" ? "http://localhost:3100" : page.url()).origin;
}

/** A company with a won deal (made as Management, who may do both), and one invoice on it. */
async function wonDealWithInvoice(page: Page, label: string, amount: number) {
  const suffix = uniqueSuffix();
  const name = `${label} ${suffix}`;
  const origin = await originOf(page);
  const { company } = await (await apiPost(page, `/api/orgs/${ORG_SLUG}/companies`, { name, email: `e2e-${suffix}@example.com` })).json();
  const ref = await (await page.request.get(`/api/orgs/${ORG_SLUG}/reference-data`)).json();
  const stage = (key: string) => ref.pipelineStages.find((s: { key: string }) => s.key === key).id as string;
  const deal = await (await apiPost(page, `/api/orgs/${ORG_SLUG}/deals`, { companyId: company.id, pipelineStageId: stage("NEGOTIATION"), value: amount, currency: "KES" })).json();
  const won = await page.request.patch(`/api/orgs/${ORG_SLUG}/deals/${deal.id}`, { data: { pipelineStageId: stage("CLOSED_WON"), handoff: { ownerLater: true } }, headers: { origin } });
  expect(won.ok(), await won.text()).toBe(true);
  // Management does not hold finance.manage.payments: the invoice is made by the Finance account, which is where this helper leaves the page signed in.
  await signInAs(page, "dev.finance@figbloom.local");
  const number = `E2E-${suffix}`.toUpperCase();
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const inv = await apiPost(page, `/api/orgs/${ORG_SLUG}/invoices`, { number, amount, issuedOn: iso(new Date(today.getTime() - 40 * 86_400_000)), dueOn: iso(new Date(today.getTime() - 10 * 86_400_000)), dealId: deal.id, sent: true });
  expect(inv.ok(), await inv.text()).toBe(true);
  return { name, number, dealId: deal.id as string, invoiceId: (await inv.json()).id as string, companyId: company.id as string };
}

test.describe("the payments tracker", () => {
  test("Finance sees the won deal, marks the invoice paid in full, and Customer 360 follows", async ({ page }) => {
    await signInAs(page, "dev.management@figbloom.local");
    const d = await wonDealWithInvoice(page, "E2E Pay Co", 90_000);
    await signInAs(page, "dev.finance@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/payments`);
    await expect(page.getByRole("heading", { name: "Payments", level: 1 })).toBeVisible();
    await expect(page.getByText("Finance · view and update status")).toBeVisible();
    await expect(page.getByText("bank and M-Pesa details are never stored here")).toBeVisible();

    const row = page.getByRole("button", { name: new RegExp(d.name) });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Overdue");
    await row.click();
    await expect(page.getByText(d.number)).toBeVisible();
    await page.getByRole("button", { name: `Mark ${d.number} paid in full` }).click();
    await expect(page.getByText(`${d.number} marked paid in full.`, { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(d.name) })).toContainText("Paid in full");

    // The status is the API's, and Customer 360 reads the same invoice.
    const invoice = await (await page.request.get(`/api/orgs/${ORG_SLUG}/invoices/${d.invoiceId}`)).json();
    expect(invoice.status).toBe("PAID");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/companies/${d.companyId}`);
    await expect(page.getByText(d.number).first()).toBeVisible();
  });

  test("a payment recorded by mistake is reversed with a reason and the record stays", async ({ page }) => {
    await signInAs(page, "dev.management@figbloom.local");
    const d = await wonDealWithInvoice(page, "E2E Reverse Co", 40_000);
    await signInAs(page, "dev.finance@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/payments?invoice=${d.invoiceId}`);
    const dialog = page.getByRole("dialog", { name: `Invoice ${d.number}` });
    await dialog.getByLabel("Amount received").fill("10000");
    await dialog.getByRole("button", { name: "Record payment" }).click();
    // The invoice is past its due date, so the API's derived status stays Overdue after a part payment; what changes is the money received.
    await expect(dialog.getByText("Overdue").first()).toBeVisible();
    await expect(dialog.getByRole("listitem").filter({ hasText: "KES 10,000" })).toBeVisible();
    await expect(dialog.getByText("KES 30,000").first()).toBeVisible(); // the balance left on KES 40,000
    await dialog.getByRole("button", { name: "Reverse", exact: true }).click();
    await dialog.getByLabel(/Why is it reversed/).fill("Wrong invoice");
    await dialog.getByRole("button", { name: "Reverse payment" }).click();
    await expect(dialog.getByText("Reversed: Wrong invoice")).toBeVisible();
  });

  test("Finance keeps one next follow-up note on a won deal", async ({ page }) => {
    await signInAs(page, "dev.management@figbloom.local");
    const d = await wonDealWithInvoice(page, "E2E Note Co", 25_000);
    await signInAs(page, "dev.finance@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/payments`);
    await page.getByRole("button", { name: new RegExp(d.name) }).click();
    await page.getByRole("button", { name: "Add payment follow-up" }).click();
    await page.getByLabel("What happens next?").fill("Call accounts on Friday");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Call accounts on Friday")).toBeVisible();
  });

  test("Management also reads the invoice's audit trail", async ({ page }) => {
    await signInAs(page, "dev.management@figbloom.local");
    const d = await wonDealWithInvoice(page, "E2E Audit Co", 15_000);
    await signInAs(page, "dev.management@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/payments?invoice=${d.invoiceId}`);
    const dialog = page.getByRole("dialog", { name: `Invoice ${d.number}` });
    await expect(dialog.getByRole("region", { name: "Audit trail" })).toBeVisible();
  });

  for (const [who, email] of [["Sales", "dev.sales@figbloom.local"], ["Delivery", "dev.delivery@figbloom.local"], ["Restricted Technical", "dev.tech@figbloom.local"]] as const) {
    test(`${who} gets the explained no-access page and no payment data anywhere`, async ({ page }) => {
      await signInAs(page, email);
      await gotoAndSettle(page, `/o/${ORG_SLUG}/payments`);
      await expect(page.getByText(/Payments isn.t part of your workspace/)).toBeVisible();
      await expect(page.getByText(/KES\s?\d/)).toHaveCount(0);
      const api = await page.request.get(`/api/orgs/${ORG_SLUG}/payments/deals`);
      expect(api.status()).toBe(403);
      expect(await page.getByRole("link", { name: "Payments" }).count()).toBe(0);
    });
  }
});
