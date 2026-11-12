import { expect, test } from "@playwright/test";
import { gotoAndSettle, loginAs } from "./helpers";

/**
 * FIG-1600 (P2-17): a Sales member adds a lead and Management sees it in the bell. Not run in CI yet: it needs the dev
 * accounts on a database that has migration 20261126100000 applied (same set-up as notifications.spec.ts).
 * Management asks for lead events instantly (the default is the hourly digest), Sales adds the lead through the API,
 * Management's bell shows "added a lead", and Sales has no notification about their own action.
 */
test("a lead added by Sales shows up in Management's bell, and not in Sales's own", async ({ browser }) => {
  const managerContext = await browser.newContext();
  const manager = await managerContext.newPage();
  await loginAs(manager, "dev.management@figbloom.local");
  const csrf = (await managerContext.cookies()).find((c) => /csrf/i.test(c.name))?.value;
  const headers = csrf ? { "x-csrf-token": csrf } : undefined;
  const set = await manager.request.patch("/api/orgs/figbloom/me/notification-preferences", {
    data: { teamActivity: { LEAD_CREATED: { inApp: true, mode: "INSTANT" } } },
    headers,
  });
  expect(set.ok()).toBe(true);

  const salesContext = await browser.newContext();
  const sales = await salesContext.newPage();
  await loginAs(sales, "dev.sales@figbloom.local");
  const ref = await (await sales.request.get("/api/orgs/figbloom/reference-data")).json();
  const salesCsrf = (await salesContext.cookies()).find((c) => /csrf/i.test(c.name))?.value;
  const created = await sales.request.post("/api/orgs/figbloom/leads", {
    data: { leadStatusId: ref.leadStatuses[0].id },
    headers: salesCsrf ? { "x-csrf-token": salesCsrf, "idempotency-key": `ta-${Date.now()}` } : { "idempotency-key": `ta-${Date.now()}` },
  });
  expect(created.ok()).toBe(true);

  await gotoAndSettle(manager, "/o/figbloom");
  const bell = manager.getByRole("button", { name: /^Notifications/ });
  await bell.click();
  await expect(manager.locator(".fb-notifpanel li", { hasText: "added a lead" }).first()).toBeVisible();

  await gotoAndSettle(sales, "/o/figbloom");
  await sales.getByRole("button", { name: /^Notifications/ }).click();
  await expect(sales.locator(".fb-notifpanel li", { hasText: "added a lead" })).toHaveCount(0);

  await managerContext.close();
  await salesContext.close();
});
