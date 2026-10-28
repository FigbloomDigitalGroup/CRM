import { expect, test } from "@playwright/test";
import { loginAs, ORG_SLUG } from "./helpers";

/**
 * FIG-791 acceptance: every page is usable at 375 px. The pages without a phone twin are the responsive desktop pages; this walks each one as
 * Management (who can open them all) with the phone's desktop view chosen, and checks that nothing makes the page scroll sideways and that the
 * menu button opens the drawer navigation. Tables may scroll inside their own container, which is allowed and is what the check tolerates.
 */
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

const PAGES = ["", "/leads", "/deals", "/handoffs", "/tasks", "/calendar", "/companies", "/contacts", "/conversations", "/renewals", "/payments", "/reports", "/notifications", "/merge", "/settings", "/preferences"];

test.describe("every page at 375 px", () => {
  test.beforeEach(async ({ page }) => {
    // The desktop pages themselves, not their phone twins.
    await page.addInitScript(() => window.sessionStorage.setItem("figbloom-desktop-view", "1"));
    await loginAs(page, "dev.management@figbloom.local");
  });

  for (const path of PAGES) {
    test(`${path || "/ (home)"} does not scroll sideways`, async ({ page }) => {
      await page.goto(`/o/${ORG_SLUG}${path}`);
      await page.waitForLoadState("networkidle");
      const over = await page.evaluate(() => {
        const doc = document.documentElement;
        const wide = Array.from(document.querySelectorAll<HTMLElement>("body *"))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.right <= window.innerWidth + 1) return false;
            // Inside a scroll container of its own (a table wrapper) is fine.
            for (let p: HTMLElement | null = el.parentElement; p && p !== document.body; p = p.parentElement) {
              const o = getComputedStyle(p).overflowX;
              if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return false;
            }
            return true;
          })
          .slice(0, 5)
          .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`);
        return { scroll: doc.scrollWidth - window.innerWidth, wide };
      });
      expect(over.scroll, `sideways scroll; widest: ${over.wide.join(", ")}`).toBeLessThanOrEqual(1);
    });
  }

  test("the menu button opens the navigation drawer", async ({ page }) => {
    await page.goto(`/o/${ORG_SLUG}/deals`);
    await page.getByRole("button", { name: "Open navigation" }).first().click();
    await expect(page.getByRole("link", { name: "Leads" }).first()).toBeVisible();
  });
});
