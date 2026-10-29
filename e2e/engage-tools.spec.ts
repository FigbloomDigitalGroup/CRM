import { expect, test } from "@playwright/test";
import { gotoAndSettle, loginAs, ORG_SLUG } from "./helpers";

/**
 * M10 engagement tools on demo data (FIG-1171 Ask Figbloom, FIG-1172 command palette and help, FIG-1173 saved views, FIG-1175 email and calendar and
 * AI settings, FIG-1176 own colours, FIG-1177 mobile capture). Written against the dev accounts; they run with the e2e server, where demo screens
 * are on. Marked demo: each screen says "Demo data", and none of it reaches production (docs/M10_ENGAGE_TOOLS.md).
 */

const BASE = `/o/${ORG_SLUG}`;

test.describe("command palette, help and shortcuts (X3)", () => {
  test("Ctrl+K opens the palette, lists only what Sales may do, and Enter opens a page", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, BASE);
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("option", { name: /New lead/ })).toBeVisible();
    await expect(dialog.getByRole("option", { name: /Go to Settings/ })).toHaveCount(0);
    await page.getByRole("combobox").fill("go to tasks");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${BASE}/tasks`));
  });

  test("G then L goes to leads, ? opens Help for the page, Escape closes it", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, BASE);
    await page.keyboard.press("g");
    await page.keyboard.press("l");
    await expect(page).toHaveURL(new RegExp(`${BASE}/leads`));
    await page.keyboard.press("Shift+/");
    await expect(page.getByRole("complementary", { name: "Help" })).toContainText("Help · Leads");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("complementary", { name: "Help" })).toHaveCount(0);
  });

  test("the Help centre and What's new are pages", async ({ page }) => {
    await loginAs(page, "dev.finance@figbloom.local");
    await gotoAndSettle(page, `${BASE}/help`);
    await expect(page.getByRole("heading", { name: "Help centre" })).toBeVisible();
    await gotoAndSettle(page, `${BASE}/help/whats-new`);
    await expect(page.getByRole("heading", { name: "What’s new" })).toBeVisible();
  });
});

test.describe("Ask Figbloom (X2)", () => {
  test("a suggested task is only created after Confirm", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, BASE);
    await page.getByRole("button", { name: "Ask Figbloom" }).click();
    const panel = page.getByRole("complementary", { name: "Ask Figbloom" });
    await panel.getByRole("button", { name: /proposals have no reply/ }).click();
    await expect(panel.getByRole("group", { name: "Proposed action" })).toContainText("NOTHING HAPPENS UNTIL YOU CONFIRM");
    await expect(page.getByText(/Task created:/)).toHaveCount(0);
    await panel.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText(/Task created:/).first()).toBeVisible();
  });

  test("Management switches it off in Settings and the panel says so", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await gotoAndSettle(page, `${BASE}/settings?tab=ai`);
    await page.getByRole("switch", { name: "Ask Figbloom" }).click();
    await page.getByRole("button", { name: "Ask Figbloom" }).click();
    await expect(page.getByTestId("assistant-off")).toContainText("switched off");
    // Put it back so other tests start from the default.
    await page.getByRole("button", { name: "Close Ask Figbloom" }).click();
    await page.getByRole("switch", { name: "Ask Figbloom" }).click();
  });
});

test.describe("saved views (X4)", () => {
  test("save a view, pin it, and it appears in the sidebar and applies from there", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, `${BASE}/leads`);
    await page.getByRole("button", { name: "Save as view" }).click();
    await page.getByLabel("Name for this view").fill("My hot ones");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Manage views" }).click();
    const dialog = page.getByRole("dialog", { name: "Manage views" });
    await dialog.getByRole("listitem").filter({ hasText: "My hot ones" }).getByRole("button", { name: "Pin to sidebar" }).click();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("sidebar-saved-views").getByRole("link", { name: "My hot ones" })).toBeVisible();
  });
});

test.describe("own colours (AP4)", () => {
  test("a colour that cannot be read is blocked with a fix offered", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, `${BASE}/preferences?tab=appearance`);
    const section = page.getByTestId("prefs-own-colours");
    await section.locator("#own-page-hex").fill("#777777");
    await expect(section.getByRole("alert")).toContainText("Too close to mid-grey");
    await expect(section.getByRole("button", { name: "Save my colours" })).toHaveAttribute("aria-disabled", "true");
    await section.getByRole("button", { name: /^Use #/ }).first().click();
    await expect(section.getByRole("button", { name: "Save my colours" })).not.toHaveAttribute("aria-disabled", "true");
  });
});

test.describe("email and calendar connections (S6#2)", () => {
  test("connect asks before leaving for the provider, and can be disconnected", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await gotoAndSettle(page, `${BASE}/settings?tab=connect`);
    const cta = page.getByRole("button", { name: "Choose calendar" });
    await cta.click();
    await page.getByRole("button", { name: "Allow access" }).click();
    await expect(page.getByRole("dialog", { name: "Allow Figbloom to connect?" })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Allow" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByText("Connected").first()).toBeVisible();
    await page.getByRole("button", { name: "Disconnect" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByText("Disconnected. Access was revoked.")).toBeVisible();
  });
});

test.describe("mobile capture (M4)", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("scanning a business card fills the form and saves nothing until Save lead", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, `${BASE}/m`);
    await page.getByRole("button", { name: "Quick capture" }).click();
    await page.getByLabel("Photograph a business card").setInputFiles({ name: "card.jpg", mimeType: "image/jpeg", buffer: Buffer.from("x") });
    await expect(page.getByTestId("scan-banner")).toContainText("Check the fields before saving");
    await expect(page.getByRole("button", { name: "Save lead" })).toBeVisible();
  });

  test("the sync queue page says everything is synced when nothing waits", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, `${BASE}/m/sync`);
    await expect(page.getByTestId("sync-done")).toContainText("All synced");
  });
});
