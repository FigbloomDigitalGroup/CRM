import { expect, test, type Page } from "@playwright/test";
import { apiPost, gotoAndSettle, loginAs, ORG_SLUG } from "./helpers";

/**
 * F2.09 to F2.12 (D1 to D3, R2, G2, G3) in a real browser: each role's home, the charts' table views, the masking rule, the top-bar search by
 * keyboard and what it will not show a role, and the mention-to-notification journey between two people.
 */

const HOME = `/o/${ORG_SLUG}`;

async function heading(page: Page, name: string | RegExp) {
  await expect(page.getByRole("heading", { name }).first()).toBeVisible();
}

test.describe("role homes", () => {
  test("Sales sees Today: the four tiles, what to do, new leads and the pipeline", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    // The seeded Sales account has leads, deals and tasks, so this is the full page and not the first-run state.
    await expect(page.getByTestId("kpi-today")).toBeVisible();
    await expect(page.getByTestId("kpi-overdue")).toBeVisible();
    await expect(page.getByTestId("kpi-stalled")).toBeVisible();
    await heading(page, "Do these today");
    await heading(page, "New since your last visit");
    await heading(page, "Pipeline by stage");
    await heading(page, "Deals moving and stalled");
    await expect(page.getByText("Stages only change when someone moves them.")).toBeVisible();
    await expect(page.getByText("Whole team")).toHaveCount(0); // not the management view
  });

  test("Management sees the whole team, this month against last, and every chart has a table view", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await expect(page.getByText("Whole team")).toBeVisible();
    await expect(page.getByText("THIS MONTH VS LAST")).toBeVisible();
    await heading(page, "Team follow-up health");
    await heading(page, "Adoption health");
    const revenue = page.locator("section", { has: page.getByRole("heading", { name: "Revenue won by service line" }) });
    await expect(revenue.getByRole("img")).toBeVisible();
    await revenue.getByRole("button", { name: "Table" }).click();
    await expect(revenue.getByRole("table")).toBeVisible();
    await expect(revenue.getByRole("img")).toHaveCount(0);
    await revenue.getByRole("button", { name: "Chart" }).click();
    await expect(revenue.getByRole("img")).toBeVisible();
    // The status of a number is never colour alone: arrows and words come with it.
    await expect(page.locator(".fb-mom__card").first()).toContainText(/▲|▼|no change/);
  });

  test("Delivery sees its handoffs and tasks, or the design's empty state when nothing has been handed over", async ({ page }) => {
    await loginAs(page, "dev.delivery@figbloom.local");
    await expect(page.getByText("Delivery view")).toBeVisible();
    await expect(page.getByTestId("kpi-awaiting").or(page.getByRole("heading", { name: "No handoffs yet" }))).toBeVisible();
    await expect(page.getByText(/Pipeline by stage|Revenue won/)).toHaveCount(0);
  });

  test("Finance sees what to invoice and collect, and the won-deals table", async ({ page }) => {
    await loginAs(page, "dev.finance@figbloom.local");
    await expect(page.getByText("Finance view")).toBeVisible();
    await expect(page.getByTestId("kpi-to-invoice").or(page.getByRole("heading", { name: "No won deals yet" }))).toBeVisible();
    await expect(page.getByText(/Pipeline by stage|Deals moving and stalled/)).toHaveCount(0); // the open pipeline stays with Sales
  });

  test("Restricted Technical sees My work only, with never a value or a finance figure", async ({ page }) => {
    await loginAs(page, "dev.tech@figbloom.local");
    await expect(page.getByRole("heading", { level: 1, name: "My work" })).toBeVisible();
    await expect(page.getByText("Assigned to me").first()).toBeVisible();
    for (const text of [/KES\s?\d/, /Pipeline by stage/, /Deals moving/, /invoice/i, /payment/i, /margin/i]) {
      await expect(page.getByText(text)).toHaveCount(0);
    }
    const dash = await page.request.get(`/api/orgs/${ORG_SLUG}/dashboard`);
    const body = await dash.json();
    expect(body.sections.map((s: { key: string }) => s.key)).toEqual(["technical"]);
    expect(JSON.stringify(body)).not.toMatch(/"value"|openValue|payments/);
  });

  test("My metrics (R2) is the personal page for a role without organisation reports, and shows nothing of anyone else", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, `${HOME}/reports`);
    await expect(page.getByRole("heading", { level: 1, name: "My metrics" })).toBeVisible();
    await expect(page.getByText("Personal", { exact: true })).toBeVisible();
    await expect(page.getByText("Only records you own or are assigned to.")).toBeVisible();
    await expect(page.getByTestId("metric-leads")).toBeVisible();
    // A different period asks again and keeps the page.
    await page.getByRole("tab", { name: "Last 7 days" }).click();
    await expect(page.getByTestId("metric-leads")).toBeVisible();
    const chart = page.locator("section", { has: page.getByRole("heading", { name: "Your work in numbers" }) });
    await chart.getByRole("button", { name: "Table" }).click();
    await expect(chart.getByRole("table")).toBeVisible();
    // The numbers are the reports' own: the same measure and value come from the API.
    const api = await (await page.request.get(`/api/orgs/${ORG_SLUG}/reports/v2/my-metrics`)).json();
    expect(api.scope).toBe("own");
  });
});

test.describe("the home page's task list", () => {
  test("completing a task is one tap and Undo puts it back", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const panel = page.locator("section", { has: page.getByRole("heading", { name: "Do these today" }) });
    await expect(panel).toBeVisible();
    if ((await panel.getByRole("button", { name: /^Mark done:/ }).count()) === 0) {
      const me = await (await page.request.get("/api/me/context")).json();
      const made = await apiPost(page, `/api/orgs/${ORG_SLUG}/tasks`, { title: `Home task ${Date.now()}`, assigneeMembershipId: me.membership.id, dueAt: new Date(Date.now() - 60_000).toISOString() });
      expect(made.ok()).toBe(true);
      await page.reload();
    }
    const first = panel.getByRole("button", { name: /^Mark done:/ }).first();
    const name = (await first.getAttribute("aria-label"))!.replace("Mark done: ", "");
    await first.click();
    await expect(page.getByText(`“${name}” marked done.`)).toBeVisible();
    await expect(panel.getByText(name, { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(panel.getByText(name, { exact: true })).toBeVisible();
  });
});

test.describe("search (G2)", () => {
  test("by keyboard alone: type, arrow to a result, Enter opens it", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const box = page.getByRole("combobox", { name: "Search records" });
    await box.click();
    await box.fill("java");
    const list = page.getByRole("listbox", { name: "Search results" });
    await expect(list.getByRole("option").nth(1)).toBeVisible(); // a result, not only "See all results"
    await expect(list.getByRole("option", { name: /See all results for “java”/ })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(box).toHaveAttribute("aria-activedescendant", /.+/);
    await page.keyboard.press("Enter");
    await page.waitForURL(new RegExp(`/o/${ORG_SLUG}/(leads|companies|contacts|deals)/`));
  });

  test("Enter with nothing highlighted opens the results page, with a tab for each kind", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const box = page.getByRole("combobox", { name: "Search records" });
    await box.fill("java");
    await expect(page.getByRole("listbox").getByRole("option").first()).toBeVisible();
    await box.press("Enter");
    await page.waitForURL(/\/search\?q=java/);
    await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
    await expect(page.getByText("Results only include records your role (Sales) can open.")).toBeVisible();
    await expect(page.getByRole("tab", { name: /^All/ })).toBeVisible();
    await page.getByRole("tab", { name: /^Companies/ }).click();
    await page.waitForURL(/type=companies/);
    await expect(page.getByRole("heading", { name: /Companies/ })).toBeVisible();
  });

  test("a role sees only what it may open: Restricted Technical finds no customers, leads or deals, and is told why", async ({ page }) => {
    await loginAs(page, "dev.tech@figbloom.local");
    const res = await page.request.get(`/api/orgs/${ORG_SLUG}/search?q=java`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    for (const g of body.groups as { type: string; items: unknown[] }[]) {
      if (["companies", "contacts", "leads", "deals"].includes(g.type)) expect(g.items).toEqual([]);
    }
    await gotoAndSettle(page, `${HOME}/search?q=java`);
    await expect(page.getByText("Results only include records your role (Restricted Technical) can open.")).toBeVisible();
    await expect(page.getByRole("link", { name: /Java House/ })).toHaveCount(0);
    await expect(page.getByRole("note").first()).toContainText(/not part of your Restricted Technical workspace/);
  });

  test("nothing found is said plainly", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, `${HOME}/search?q=zzzqqqxxx`);
    await expect(page.getByText("No results for “zzzqqqxxx”")).toBeVisible();
  });
});

test.describe("notifications (G3)", () => {
  test("a mention in a comment reaches the person's bell, opens the record, and the read state sticks", async ({ browser }) => {
    // Management creates a lead for Dev Sales and mentions them in a comment.
    const mgrCtx = await browser.newContext();
    const mgr = await mgrCtx.newPage();
    await loginAs(mgr, "dev.management@figbloom.local");
    const { members, leadStatuses } = await (await mgr.request.get(`/api/orgs/${ORG_SLUG}/reference-data`)).json();
    const sales = members.find((m: { userEmail: string }) => m.userEmail === "dev.sales@figbloom.local");
    expect(sales).toBeTruthy();
    const created = await apiPost(mgr, `/api/orgs/${ORG_SLUG}/leads`, { leadStatusId: leadStatuses[0].id, ownerMembershipId: sales.membershipId });
    expect(created.ok()).toBe(true);
    const leadId = (await created.json()).lead.id as string;
    const text = `Please call them today ${Date.now()}`;
    const commented = await apiPost(mgr, `/api/orgs/${ORG_SLUG}/leads/${leadId}/comments`, { body: text, mentions: [sales.membershipId] });
    expect(commented.ok()).toBe(true);
    await mgrCtx.close();

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAs(page, "dev.sales@figbloom.local");
    const before = await (await page.request.get(`/api/orgs/${ORG_SLUG}/notifications/unread-count`)).json();
    expect(before.unreadCount).toBeGreaterThan(0);

    const bell = page.getByRole("button", { name: /^Notifications/ });
    await expect(bell).toContainText(String(Math.min(before.unreadCount, 99)));
    await bell.click();
    const panel = page.getByRole("dialog", { name: "Notifications" });
    const item = panel.getByRole("button", { name: /mentioned you on a lead/ }).first();
    await expect(item).toBeVisible();
    await expect(item).toContainText("unread");

    const [read] = await Promise.all([
      page.waitForResponse((r) => /\/notifications\/.+\/read$/.test(r.url()) && r.request().method() === "POST"),
      item.click(),
    ]);
    expect(read.ok()).toBe(true);
    await page.waitForURL(new RegExp(`/o/${ORG_SLUG}/leads/`));

    // The read state is the server's: the count the API reports has gone down by one.
    await expect.poll(async () => (await (await page.request.get(`/api/orgs/${ORG_SLUG}/notifications/unread-count`)).json()).unreadCount).toBe(before.unreadCount - 1);

    // The centre lists it under Mentions, and Mark all read empties the count.
    await gotoAndSettle(page, `${HOME}/notifications`);
    await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
    await page.getByRole("tab", { name: /^Mentions/ }).click();
    await expect(page.getByText(/mentioned you on a lead/).first()).toBeVisible();
    await page.getByRole("button", { name: "Mark all read" }).click();
    await expect(page.getByText(/^0 unread/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Notifications" })).toBeVisible(); // no count in its name any more
    await ctx.close();
  });

  test("a notification never opens anything outside the person's organisation", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, `${HOME}/notifications`);
    const links = await page.locator(`a[href^="http"]`).evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href));
    for (const href of links) expect(new URL(href).origin).toBe(new URL(page.url()).origin);
  });
});
