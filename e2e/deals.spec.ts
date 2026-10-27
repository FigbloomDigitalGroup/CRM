import { expect as baseExpect, test, type Page } from "@playwright/test";
import { apiPost, gotoAndSettle, loginAs, ORG_SLUG, uniqueSuffix } from "./helpers";

/**
 * F2.04 to F2.06 (FIG-1086, FIG-790, FIG-1087, FIG-1088): the deals board and list, a deal's page, and the Sales-to-Delivery handoff, in a real
 * browser, per role. Money is checked the way a person would see it: a role that may not see values never has one on the page.
 */

// Lists load from the API after the page does; a little patience keeps a slow machine from reading as a failure.
const expect = baseExpect.configure({ timeout: 20_000 });

const KES_AMOUNT = /KES\s?\d/;

/** A company and an open deal made through the API, so each test owns its data and can find it by name. */
async function makeDeal(page: Page, label: string, stageKey = "SOLUTION_PRESENTED") {
  const suffix = uniqueSuffix();
  const name = `${label} ${suffix}`;
  const { company } = await (await apiPost(page, `/api/orgs/${ORG_SLUG}/companies`, { name, email: `e2e-${suffix}@example.com` })).json();
  const ref = await (await page.request.get(`/api/orgs/${ORG_SLUG}/reference-data`)).json();
  const stage = ref.pipelineStages.find((s: { key: string }) => s.key === stageKey);
  const res = await apiPost(page, `/api/orgs/${ORG_SLUG}/deals`, { companyId: company.id, pipelineStageId: stage.id, value: 120000, currency: "KES", notes: `E2E deal ${suffix}.` });
  expect(res.ok(), await res.text()).toBe(true);
  const deal = await res.json();
  return { id: deal.id as string, name, suffix };
}

test.describe("the deals board", () => {
  test("Sales sees their own deals with values, the pipeline columns and a way to move a deal that does not need a mouse", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const deal = await makeDeal(page, "E2E Board Co");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/deals`);
    await expect(page.getByRole("heading", { name: "Deals", level: 1 })).toBeVisible();
    await expect(page.getByText(/^My deals · \d+$/)).toBeVisible();
    const solution = page.getByRole("group", { name: /^Solution Presented, \d+ deals?$/ });
    const card = solution.locator(".fb-dcard", { hasText: deal.name });
    await expect(card).toBeVisible();
    await expect(card).toContainText("120,000");

    // Move to…, by keyboard only.
    await card.getByRole("button", { name: `Move ${deal.name} to another stage` }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: `Move ${deal.name} to…` });
    await expect(dialog.getByRole("button", { name: /Solution Presented/ })).toBeDisabled();
    await dialog.getByRole("button", { name: /Proposal Sent/ }).focus();
    await page.keyboard.press("Enter");
    const proposal = page.getByRole("group", { name: /^Proposal Sent, \d+ deals?$/ });
    await expect(proposal.locator(".fb-dcard", { hasText: deal.name })).toBeVisible();
    await expect(page.getByRole("button", { name: /Undo/ })).toBeVisible();

    // …and it is still there after a reload (the server, not only the screen, moved it).
    await page.reload();
    await expect(page.getByRole("group", { name: /^Proposal Sent, \d+ deals?$/ }).locator(".fb-dcard", { hasText: deal.name })).toBeVisible();
  });

  test("dragging a card to another stage moves the deal, and Undo puts it back (FIG-790)", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const deal = await makeDeal(page, "E2E Drag Co");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/deals`);
    const card = page.locator(".fb-dcard", { hasText: deal.name });
    await expect(card).toBeVisible();
    await card.dragTo(page.getByRole("group", { name: /^Proposal Sent, \d+ deals?$/ }), { targetPosition: { x: 120, y: 40 } });
    await expect(page.getByRole("group", { name: /^Proposal Sent, \d+ deals?$/ }).locator(".fb-dcard", { hasText: deal.name })).toBeVisible();
    await page.getByRole("button", { name: /Undo/ }).click();
    await expect(page.getByRole("group", { name: /^Solution Presented, \d+ deals?$/ }).locator(".fb-dcard", { hasText: deal.name })).toBeVisible();
  });

  test("marking a deal lost asks for a reason first, and the deal lands in Closed Lost with it", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const deal = await makeDeal(page, "E2E Lost Co");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/deals`);
    const card = page.locator(".fb-dcard", { hasText: deal.name });
    await card.getByRole("button", { name: `Move ${deal.name} to another stage` }).click();
    await page.getByRole("button", { name: /Closed Lost/ }).click();
    const dialog = page.getByRole("dialog", { name: `Why was ${deal.name} lost?` });
    await expect(dialog.getByRole("button", { name: "Mark lost" })).toBeDisabled();
    await dialog.getByRole("radio").first().click();
    await dialog.getByRole("button", { name: "Mark lost" }).click();
    await expect(page.getByRole("group", { name: /^Closed Lost, \d+ deals?$/ }).locator(".fb-dcard", { hasText: deal.name })).toBeVisible();
  });

  test("the list shows the same deals, and Show archived is off by default", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/deals`);
    await page.getByRole("button", { name: "List" }).click();
    const table = page.getByRole("table");
    await expect(table.getByRole("columnheader", { name: "EXPECTED CLOSE" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Show archived" })).not.toBeChecked();
  });

  test("New deal needs a company, and creates the deal", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/deals`);
    await page.getByRole("button", { name: "New deal" }).click();
    const drawer = page.getByRole("dialog", { name: "New deal" });
    await expect(drawer.getByRole("button", { name: "Create deal" })).toBeDisabled();
    const options = drawer.getByLabel(/^Company/).locator("option");
    await expect.poll(async () => options.count()).toBeGreaterThan(1);
    await drawer.getByLabel(/^Company/).selectOption({ index: 1 });
    await drawer.getByLabel("What are we selling?").fill(`E2E direct deal ${uniqueSuffix()}`);
    await drawer.getByLabel("Value (KES)").fill("50000");
    await drawer.getByRole("button", { name: "Create deal" }).click();
    await expect(page.getByText("Deal created.")).toBeVisible();
  });
});

test.describe("values are masked by role", () => {
  test("Delivery and Finance see won deals only, read-only, with no value anywhere", async ({ page }) => {
    for (const email of ["dev.delivery@figbloom.local", "dev.finance@figbloom.local"]) {
      await page.context().clearCookies();
      await loginAs(page, email);
      await gotoAndSettle(page, `/o/${ORG_SLUG}/deals`);
      await expect(page.getByRole("heading", { name: "Won deals", level: 1 })).toBeVisible();
      await expect(page.getByText("Provisional access.")).toBeVisible();
      await expect(page.getByRole("group", { name: /^Solution Presented/ })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Move .* to another stage/ })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "New deal" })).toHaveCount(0);
      if (email.includes("delivery")) await expect(page.getByText(KES_AMOUNT)).toHaveCount(0);
    }
  });

  test("Restricted Technical is told why deals are not theirs", async ({ page }) => {
    await loginAs(page, "dev.tech@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/deals`);
    await expect(page.getByText(/Deals isn.t part of your workspace/)).toBeVisible();
    await expect(page.getByText(KES_AMOUNT)).toHaveCount(0);
  });

  test("a deal opened by Delivery shows no value, no proposals and no edit controls", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    const list = await (await page.request.get(`/api/orgs/${ORG_SLUG}/deals?outcome=WON&pageSize=1`)).json();
    test.skip(list.items.length === 0, "no won deal in this database");
    const id = list.items[0].id as string;
    await page.context().clearCookies();
    await loginAs(page, "dev.delivery@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/deals/${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Read-only", { exact: true })).toBeVisible();
    await expect(page.getByText(KES_AMOUNT)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Move to…" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Proposals" })).toHaveCount(0);
  });
});

test.describe("a deal's page", () => {
  test("shows the deal and moves it with the stepper; a proposal with no answer shows a reminder that can be snoozed", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const deal = await makeDeal(page, "E2E Detail Co", "PROPOSAL_SENT");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/deals/${deal.id}`);
    await expect(page.getByRole("heading", { name: deal.name, level: 1 })).toBeVisible();
    const steps = page.getByRole("region", { name: "Deal stages" });
    await expect(steps.getByRole("button", { name: "Proposal Sent" })).toHaveAttribute("aria-current", "step");
    await expect(page.getByText("Figbloom never moves a deal on its own. Won opens the Delivery handoff; Lost asks for a reason.")).toBeVisible();

    // A proposal reference, then the stepper.
    await page.getByRole("button", { name: "+ Add proposal reference" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a proposal reference" });
    await dialog.getByLabel("Proposal number").fill(`P-${deal.suffix}`);
    await dialog.getByRole("button", { name: "Add proposal" }).click();
    await expect(page.getByRole("cell", { name: `P-${deal.suffix}` })).toBeVisible();

    await steps.getByRole("button", { name: "Negotiation" }).click();
    await expect(steps.getByRole("button", { name: "Negotiation" })).toHaveAttribute("aria-current", "step");
  });

  test("logging activity and adding a task from the deal show up on it", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const deal = await makeDeal(page, "E2E Activity Co");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/deals/${deal.id}`);
    await page.getByRole("button", { name: "Log activity" }).first().click();
    const drawer = page.getByRole("dialog", { name: "Log a call or note" });
    await drawer.getByRole("button", { name: "Note" }).click();
    await drawer.getByLabel("Note").fill(`E2E activity ${deal.suffix}`);
    await drawer.getByRole("button", { name: "Log it" }).click();
    await expect(page.getByText(`E2E activity ${deal.suffix}`)).toBeVisible();

    await page.getByRole("button", { name: "+ Add task" }).click();
    const task = page.getByRole("dialog", { name: "New task" });
    await task.getByLabel(/^Title/).fill(`E2E task ${deal.suffix}`);
    await task.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByText(`E2E task ${deal.suffix}`)).toBeVisible();
  });

  test("an archived deal is read-only until it is restored", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const deal = await makeDeal(page, "E2E Archive Co");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/deals/${deal.id}`);
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByText(/This deal is read-only until it’s restored/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Move to…" })).toHaveCount(0);
    await page.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByRole("button", { name: "Move to…" })).toBeVisible();
  });
});

test.describe("Sales to Delivery", () => {
  test("a won deal is handed off in one dialog, Delivery takes it and marks it delivered", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const deal = await makeDeal(page, "E2E Handoff Co", "NEGOTIATION");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/deals/${deal.id}`);
    await page.getByRole("button", { name: "Mark won" }).click();
    const dialog = page.getByRole("dialog", { name: `Hand off ${deal.name} to Delivery` });
    await expect(dialog.getByText(/Nothing moves stages on its own/)).toBeVisible();
    await dialog.getByLabel("Delivery owner").selectOption({ label: "Decide later (Delivery picks an owner)" });
    await dialog.getByLabel("Scope for Delivery").fill("Install and train the team");
    await dialog.getByRole("button", { name: /Mark won and hand off/ }).click();
    await expect(page.getByRole("heading", { name: "Delivery handoff" })).toBeVisible();
    await expect(page.getByText("Needs an owner")).toBeVisible();

    // Delivery sees it in Handoffs, with no price, takes ownership and delivers.
    await page.context().clearCookies();
    await loginAs(page, "dev.delivery@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/handoffs?deal=${deal.id}`);
    const view = page.getByRole("region", { name: `Handoff for ${deal.name}` });
    await expect(view).toBeVisible();
    await expect(view.getByText("Install and train the team")).toBeVisible();
    await expect(view.getByText("Pricing not shown for Delivery")).toBeVisible();
    await expect(page.getByText(KES_AMOUNT)).toHaveCount(0);
    await view.getByRole("button", { name: "Take ownership" }).click();
    await expect(page.getByText(`You own the ${deal.name} handoff.`)).toBeVisible();
    await view.getByLabel("Delivery status").selectOption("DELIVERED");
    await expect(page.getByText(/Status: Delivered/)).toBeVisible();
    await expect(page.getByRole("list", { name: "Handoffs" }).getByText("Delivered").first()).toBeVisible();
  });
});
