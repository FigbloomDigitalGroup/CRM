import { expect as baseExpect, test, type Page } from "@playwright/test";
import { apiPost, gotoAndSettle, loginAs, ORG_SLUG, uniqueSuffix } from "./helpers";

/**
 * Commercial screens on the real API (FIG-1168 to FIG-1170, FIG-1174), per role, in a real browser. Q2.01 (FIG-1179): rewritten on 9 Nov 2026. M14 removed the
 * demo-screens switch, so the suite needs only a server whose release reaches V1.1 (ACTIVE_RELEASE=v2, which playwright.config.ts sets); the quote,
 * approval and forecast permissions are stripped before that. The V2 API-token editor and the demo signing page were dropped with the V2 screens.
 */
const expect = baseExpect.configure({ timeout: 20_000 });

/**
 * The quote, approval, forecast and catalogue screens read the real API now, so these tests make the data they need through it (the catalogue starts
 * empty and nobody owns a spare deal). The names carry a per-run suffix so a rerun never meets what an earlier run left behind.
 */
const CATALOGUE_ITEM = "E2E Support retainer";

/** Makes sure the catalogue has an item called "E2E Support retainer" (Management only; the page that calls it must be signed in as Management). */
async function ensureCatalogueItem(manager: Page): Promise<void> {
  const found = await (await manager.request.get(`/api/orgs/${ORG_SLUG}/catalogue?q=${encodeURIComponent(CATALOGUE_ITEM)}`)).json();
  if ((found.items ?? []).some((i: { name: string }) => i.name === CATALOGUE_ITEM)) return;
  const res = await apiPost(manager, `/api/orgs/${ORG_SLUG}/catalogue`, { name: CATALOGUE_ITEM, unit: "month", price: 25000, cost: 15000 });
  expect(res.ok(), await res.text()).toBe(true);
}

/** An open deal owned by whoever the page is signed in as, on a company with a name unique to this run. */
async function makeOpenDeal(page: Page, label: string): Promise<{ id: string; company: string }> {
  const company = `${label} ${uniqueSuffix()}`;
  const made = await (await apiPost(page, `/api/orgs/${ORG_SLUG}/companies`, { name: company, email: `e2e-${uniqueSuffix()}@example.com` })).json();
  const ref = await (await page.request.get(`/api/orgs/${ORG_SLUG}/reference-data`)).json();
  const stage = ref.pipelineStages.find((s: { key: string }) => s.key === "SOLUTION_PRESENTED");
  const res = await apiPost(page, `/api/orgs/${ORG_SLUG}/deals`, { companyId: made.company.id, pipelineStageId: stage.id, value: 120000, currency: "KES", expectedCloseDate: "2026-12-15" });
  expect(res.ok(), await res.text()).toBe(true);
  return { id: (await res.json()).id as string, company };
}

test.describe("commercial screens on the real API", () => {
  test("Sales builds a quote, margin stays hidden, and a deep discount waits for Management who then decides it", async ({ page, browser }) => {
    // Set-up through the API: a catalogue item (Management) and an open deal owned by Sales with no quote yet.
    const manager = await browser.newPage();
    await loginAs(manager, "dev.management@figbloom.local");
    await ensureCatalogueItem(manager);

    await loginAs(page, "dev.sales@figbloom.local");
    const deal = await makeOpenDeal(page, "E2E Quote Co");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/quotes/${deal.id}`);
    await expect(page.getByText("Demo data")).toHaveCount(0);
    await page.getByRole("button", { name: "Start a quote" }).click();
    await expect(page.getByLabel("Add a catalogue item")).toBeVisible();
    // The approval request is titled with the quote's number ("Q-2026-… v1: 12% discount"), so read the number from the page.
    const quoteNumber = ((await page.getByRole("heading", { level: 1 }).innerText()).match(/Q-[\w-]+/) ?? [])[0];
    expect(quoteNumber, "the quote page shows its number").toBeTruthy();
    await expect(page.getByRole("columnheader", { name: "Margin" })).toHaveCount(0);

    // The catalogue picker searches as you type (it no longer lists the whole catalogue).
    await page.getByLabel("Add a catalogue item").fill(CATALOGUE_ITEM);
    await page.getByRole("option", { name: new RegExp(CATALOGUE_ITEM) }).click();
    await page.getByLabel("Discount %").fill("12");
    // Whether a quote needs approval is known once the discount is saved, so the button reads "Request approval" only after "Save draft".
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.getByRole("button", { name: /Request approval/ }).click();
    await expect(page.getByText("Waiting for Management.")).toBeVisible();
    await expect(page.getByLabel(new RegExp(`Quantity for ${CATALOGUE_ITEM}`))).toHaveAttribute("readonly", "");

    // Management sees the margin and the inbox, and decides.
    await gotoAndSettle(manager, `/o/${ORG_SLUG}/quotes/${deal.id}`);
    await expect(manager.getByRole("columnheader", { name: "Margin" })).toBeVisible();
    await gotoAndSettle(manager, `/o/${ORG_SLUG}/approvals`);
    const card = manager.getByRole("listitem").filter({ hasText: `${quoteNumber} v1: 12% discount` });
    await card.getByRole("button", { name: "Decline" }).click();
    await expect(card.getByRole("alert")).toContainText("Say why");
    await card.getByPlaceholder(/Reason/).fill("Try 5%");
    await card.getByRole("button", { name: "Decline" }).click();
    await manager.getByRole("tab", { name: /Decided/ }).click();
    await expect(manager.getByText(/Declined · Try 5%/).first()).toBeVisible();

    // The reason reaches the requester, who can only change a decided quote by making a new version (the API refuses one while a decision is pending).
    await gotoAndSettle(page, `/o/${ORG_SLUG}/quotes/${deal.id}`);
    await expect(page.getByText(/Reason: Try 5%/)).toBeVisible();
    await page.getByRole("button", { name: /New version/ }).click();
    await expect(page.getByText("Version 2")).toBeVisible();
    await expect(page.getByText("New version from v1")).toBeVisible();
    await page.getByRole("button", { name: /Preview document/ }).click();
    await expect(page.getByRole("region", { name: /document preview/ })).not.toContainText(/margin|cost/i);
  });

  test("forecast: Management sees the team and edits a target; Sales sees only their own deals", async ({ page, browser }) => {
    // Another salesperson's open deal, made through the API, is what the first Sales user must not see.
    const other = await browser.newPage();
    await loginAs(other, "dev.sales2@figbloom.local");
    const theirs = await makeOpenDeal(other, "E2E Forecast Co");

    await loginAs(page, "dev.management@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/forecast`);
    await expect(page.getByRole("img", { name: /Weighted closes/ })).toBeVisible();
    await expect(page.getByText(theirs.company)).toBeVisible();

    // A target is saved on Enter (or when the field is left). Targets persist, so a rerun changes it to the other value.
    const target = page.getByLabel(/^Target for /).first();
    const who = ((await target.getAttribute("aria-label")) ?? "").replace(/^Target for /, "");
    const next = /^1800000/.test(await target.inputValue()) ? "1900000" : "1800000";
    await target.fill(next);
    await target.press("Enter");
    await expect(page.getByText(`Target saved for ${who}`)).toBeVisible();
    await gotoAndSettle(page, `/o/${ORG_SLUG}/forecast`);
    await expect(page.getByLabel(`Target for ${who}`)).toHaveValue(new RegExp(`^${next}`));
    await page.getByRole("button", { name: "Table" }).click();
    await expect(page.getByRole("table", { name: "Expected closes by month" })).toBeVisible();

    const sales = await browser.newPage();
    await loginAs(sales, "dev.sales@figbloom.local");
    await gotoAndSettle(sales, `/o/${ORG_SLUG}/forecast`);
    await expect(sales.getByRole("heading", { name: "Forecast & targets", level: 1 })).toBeVisible();
    await expect(sales.getByText(theirs.company)).toHaveCount(0);
    await expect(sales.getByLabel(/Target for/)).toHaveCount(0);
  });

  test("settings editors explain the impact and block bad input", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/settings?tab=catalogue`);
    // The catalogue starts empty on a fresh database: make sure the item the test edits exists, and change it to a price it does not have now.
    await ensureCatalogueItem(page);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/settings?tab=catalogue`);
    const price = page.getByLabel(`Price for ${CATALOGUE_ITEM}`);
    const next = (await price.inputValue()) === "30000" ? "35000" : "30000";
    await price.fill("0");
    await expect(page.getByRole("alert").filter({ hasText: "price must be more than 0" })).toBeVisible();
    await price.fill(next);
    await expect(page.getByRole("status")).toContainText("already sent keep the price");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Catalogue changed")).toBeVisible();
  });
});

test("the client signing page is V2 and hidden: a link under /sign is a 404", async ({ page }) => {
  const sign = await page.goto("/sign/demo-unsigned");
  expect(sign?.status()).toBe(404);
});
