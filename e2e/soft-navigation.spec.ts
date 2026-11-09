import { expect, test, type Page } from "@playwright/test";
import { apiPost, gotoAndSettle, loginAs, ORG_SLUG, uniqueSuffix } from "./helpers";

/**
 * Performance branch (makeover/perf-navigation-and-queries): moving around the CRM is a client-side transition, not a document reload, and the
 * lead page asks for its pieces at the same time instead of one after another.
 *
 * "No reload" is proved with a marker on `window`: a full document load throws the page's JavaScript state away, so the marker only survives
 * client-side navigation.
 */

const MANAGEMENT = "dev.management@figbloom.local";
const MARKER = "__fbSoftNavMarker";

async function plantMarker(page: Page) {
  await page.evaluate((k) => ((window as unknown as Record<string, unknown>)[k] = 1), MARKER);
}

async function markerSurvived(page: Page) {
  return page.evaluate((k) => (window as unknown as Record<string, unknown>)[k] === 1, MARKER);
}

test.describe("client-side navigation (no document reload)", () => {
  test("the sidebar links move between sections without reloading the page", async ({ page }) => {
    await loginAs(page, MANAGEMENT);
    await gotoAndSettle(page, `/o/${ORG_SLUG}`);
    await plantMarker(page);

    const nav = page.getByRole("navigation", { name: "Main" });
    for (const [label, path] of [
      ["Leads", "/leads"],
      ["Companies", "/companies"],
      ["Deals", "/deals"],
      ["Tasks", "/tasks"],
    ] as const) {
      await nav.getByRole("link", { name: label, exact: true }).click();
      await page.waitForURL(new RegExp(`/o/${ORG_SLUG}${path}(\\?.*)?$`));
      expect(await markerSurvived(page), `${label}: the page reloaded`).toBe(true);
    }
  });

  test("a row-menu item that opens a page (the top bar's New menu) does not reload the page", async ({ page }) => {
    await loginAs(page, MANAGEMENT);
    await gotoAndSettle(page, `/o/${ORG_SLUG}`);
    await plantMarker(page);
    const before = page.url();

    await page.getByRole("button", { name: "New", exact: true }).click();
    const items = page.getByRole("menu", { name: "New" }).getByRole("menuitem");
    await expect(items.first()).toBeVisible();
    await items.first().click();

    await page.waitForURL((u) => u.toString() !== before);
    expect(await markerSurvived(page), "the New menu reloaded the page").toBe(true);
  });

  test("the Help panel's links open the Help centre without reloading the page", async ({ page }) => {
    // The Help button is one of the demo tools (src/ui/screens/assistant/ToolsHost.tsx toolsEnabled): a standard production build leaves it out, so
    // like e2e/engage-tools.spec.ts this runs only against a demo-screens server (E2E_DEMO_SCREENS=true); otherwise it is skipped, not failed.
    test.skip(process.env.E2E_DEMO_SCREENS !== "true", "needs a demo-screens server (DEMO_SCREENS, NEXT_PUBLIC_DEMO_SCREENS, ACTIVE_RELEASE=v2)");
    await loginAs(page, MANAGEMENT);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/leads`);
    await plantMarker(page);

    await page.getByRole("button", { name: /Help and what/ }).click();
    const panel = page.getByTestId("help-panel");
    await expect(panel).toBeVisible();
    await panel.getByRole("link", { name: "Open the Help centre" }).click();

    await page.waitForURL(new RegExp(`/o/${ORG_SLUG}/help$`));
    expect(await markerSurvived(page), "the Help link reloaded the page").toBe(true);
  });
});

test.describe("the lead page asks for its pieces together", () => {
  test("lead, qualification and score are requested before the lead answers", async ({ page }) => {
    await loginAs(page, MANAGEMENT);

    const ref = (await (await page.request.get(`/api/orgs/${ORG_SLUG}/reference-data`)).json()) as { leadStatuses: { id: string; key: string }[] };
    const company = await apiPost(page, `/api/orgs/${ORG_SLUG}/companies`, { name: `Soft Nav Co ${uniqueSuffix()}` });
    expect(company.ok()).toBe(true);
    const created = await apiPost(page, `/api/orgs/${ORG_SLUG}/leads`, {
      leadStatusId: ref.leadStatuses.find((s) => s.key === "NEW")!.id,
      companyId: (await company.json()).company.id,
    });
    expect(created.ok()).toBe(true);
    const leadId = (await created.json()).lead.id as string;

    await gotoAndSettle(page, `/o/${ORG_SLUG}/leads`);

    const base = `/api/orgs/${ORG_SLUG}/leads/${leadId}`;
    const started: Record<string, number> = {};
    let leadAnsweredAt = 0;
    const kind = (url: string) => {
      const path = new URL(url).pathname;
      if (path === base) return "lead";
      if (path === `${base}/qualification`) return "qualification";
      if (path === `${base}/score`) return "score";
      return null;
    };
    page.on("request", (r) => {
      const k = kind(r.url());
      if (k && started[k] === undefined) started[k] = Date.now();
    });
    page.on("response", (r) => {
      if (kind(r.url()) === "lead" && !leadAnsweredAt) leadAnsweredAt = Date.now();
    });

    await page.goto(`/o/${ORG_SLUG}/leads/${leadId}`);
    await expect.poll(() => leadAnsweredAt, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => Object.keys(started).length, { timeout: 15_000 }).toBe(3);

    expect(started.qualification, "qualification waited for the lead").toBeLessThanOrEqual(leadAnsweredAt);
    expect(started.score, "score waited for the lead").toBeLessThanOrEqual(leadAnsweredAt);
  });
});
