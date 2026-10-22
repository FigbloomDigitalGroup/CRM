import { expect, test } from "@playwright/test";
import { apiPost, gotoAndSettle, loginAs } from "./helpers";

/**
 * FIG-801: negative-permission checks for the Restricted Technical role --
 * no deal values anywhere, no way into settings administration. Checked in
 * the UI and again on the API, since hiding a link is not access control.
 */
test.describe("Restricted Technical", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "dev.tech@figbloom.local");
  });

  test("gets an explained no-access page for deals, with no nav entry and no values", async ({
    page,
  }) => {
    await expect(page.getByRole("link", { name: "Deals", exact: true })).toHaveCount(0);
    await gotoAndSettle(page, "/o/figbloom/deals");
    await expect(
      page.getByRole("heading", { name: /Deals aren.t available for your role/ }),
    ).toBeVisible();
    await expect(page.getByText(/\b(USD|EUR|GBP|ZAR)\s?[\d,]+/)).toHaveCount(0);
  });

  test("the deals API refuses the role and leaks no value", async ({ page }) => {
    const res = await page.request.get("/api/orgs/figbloom/deals");
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("FORBIDDEN");
    expect(JSON.stringify(body)).not.toMatch(/"value"/);
  });

  test("settings shows no administration sections", async ({ page }) => {
    await gotoAndSettle(page, "/o/figbloom/settings");
    // Self-service notification preferences are open to every member; nothing else is.
    for (const hidden of [
      "Organization profile",
      "Members",
      "Invite a member",
      "Reference data",
      "Integration reference",
    ]) {
      await expect(page.getByText(hidden, { exact: true })).toHaveCount(0);
    }
  });

  test("settings changes are refused on the API", async ({ page }) => {
    await gotoAndSettle(page, "/o/figbloom/settings");
    const invite = await apiPost(page, "/api/orgs/figbloom/memberships", {
      name: "Nope",
      email: "nope@example.com",
      roleKey: "SALES",
    });
    expect(invite.status()).toBe(403);
    const catalog = await apiPost(page, "/api/orgs/figbloom/reference-catalogs/leadSources", {
      name: "Nope",
    });
    expect(catalog.status()).toBe(403);
  });
});
