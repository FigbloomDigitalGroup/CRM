import { expect, test } from "@playwright/test";
import { apiPost, gotoAndSettle, loginAs } from "./helpers";

/**
 * FIG-801: receiving and reading a notification. Management creates a lead
 * owned by Dev Sales (which notifies the new owner); Dev Sales, in a separate
 * browser context, sees it in the bell, opens it, and the read state sticks.
 */
test("a lead assigned to Dev Sales shows up in their bell and can be read", async ({
  browser,
}) => {
  const managerContext = await browser.newContext();
  const manager = await managerContext.newPage();
  await loginAs(manager, "dev.management@figbloom.local");
  const refRes = await manager.request.get("/api/orgs/figbloom/reference-data");
  const { members, leadStatuses } = await refRes.json();
  const sales = members.find(
    (m: { userEmail: string }) => m.userEmail === "dev.sales@figbloom.local",
  );
  expect(sales).toBeTruthy();
  const created = await apiPost(manager, "/api/orgs/figbloom/leads", {
    leadStatusId: leadStatuses[0].id,
    ownerMembershipId: sales.membershipId,
  });
  expect(created.ok()).toBe(true);
  await managerContext.close();

  const salesContext = await browser.newContext();
  const salesPage = await salesContext.newPage();
  await loginAs(salesPage, "dev.sales@figbloom.local");
  await gotoAndSettle(salesPage, "/o/figbloom");

  // The bell is the M7 one (G3): the button's name carries the unread count, the count shows on the icon, and an unread notice in the panel is marked.
  const bell = salesPage.getByRole("button", { name: /^Notifications/ });
  await expect(bell.locator(".fb-bell__badge")).toBeVisible();
  await bell.click();

  const item = salesPage.locator(".fb-notifpanel li", { hasText: "New lead assigned to you" }).first();
  await expect(item).toHaveAttribute("data-unread", "true");

  const [readResponse] = await Promise.all([
    salesPage.waitForResponse(
      (r) => /\/notifications\/.+\/read$/.test(r.url()) && r.request().method() === "POST",
    ),
    item.getByRole("button").click(),
  ]);
  expect(readResponse.ok()).toBe(true);
  await salesPage.waitForURL(/\/o\/figbloom\/leads\//);

  // Read state is stored server-side, not just in the bell's local state.
  const list = await salesPage.request.get("/api/orgs/figbloom/notifications");
  const { notifications, unreadCount } = await list.json();
  const readOnes = notifications.filter((n: { readAt: string | null }) => n.readAt !== null);
  expect(readOnes.length).toBeGreaterThan(0);
  expect(typeof unreadCount).toBe("number");
  await salesContext.close();
});
