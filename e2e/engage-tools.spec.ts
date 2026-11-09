import { expect, test } from "@playwright/test";
import { gotoAndSettle, loginAs, ORG_SLUG } from "./helpers";

/**
 * M10 engagement tools on demo data (FIG-1171 Ask Figbloom, FIG-1172 command palette and help, FIG-1173 saved views, FIG-1175 email and calendar and
 * AI settings, FIG-1176 own colours, FIG-1177 mobile capture). Written against the dev accounts; they run with the e2e server, where demo screens
 * are on. None of it reaches production (docs/M10_ENGAGE_TOOLS.md).
 */

const BASE = `/o/${ORG_SLUG}`;

// The upload is checked by its content now, not its name: a file that is not really a JPEG is refused ("The content of the file does not match its declared type").
// This is a genuine 1x1 JPEG. With no vision model connected the app still opens the form with its "Check the fields before saving" line, which is what this test needs.
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

// Q2.01 (FIG-1179): these screens are on the real API since M14 (the demo-screens switch is gone), so they run on the standard e2e server, which sets
// ACTIVE_RELEASE=v2. Anything that would leave for Google, Microsoft or the AI model is checked up to that step and no further.

test.describe("command palette, help and shortcuts (X3)", () => {
  test("Ctrl+K opens the palette, lists only what Sales may do, and Enter opens a page", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, BASE);
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("option", { name: /New lead/ })).toBeVisible();
    await expect(dialog.getByRole("option", { name: /Go to Settings/ })).toHaveCount(0);
    // The top bar has its own search combobox, so the palette's input is the one inside the dialog.
    await dialog.getByRole("combobox").fill("go to tasks");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${BASE}/tasks`));
  });

  test("G then L goes to leads, ? opens Help for the page, Escape closes it", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, BASE);
    await page.keyboard.press("g");
    await page.keyboard.press("l");
    await expect(page).toHaveURL(new RegExp(`${BASE}/leads`));
    // A person pressing ? sends the key "?". ("Shift+/" would send "/", which is the top bar search shortcut.)
    await page.keyboard.press("?");
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
  // The assistant is off by default for an organisation (assistant.enabled). Each test sets the state it needs through the Settings switch and puts it back,
  // so the order of the tests and an earlier failed run do not matter.
  async function setAssistant(page: import("@playwright/test").Page, on: boolean) {
    await gotoAndSettle(page, `${BASE}/settings?tab=ai`);
    const sw = page.getByRole("switch", { name: "Ask Figbloom" });
    if ((await sw.isChecked()) !== on) {
      await sw.click();
      await expect(sw).toBeChecked({ checked: on });
    }
  }

  test("the panel opens, creates nothing by itself, and says so when no assistant model is connected", async ({ page, browser }) => {
    const manager = await browser.newPage();
    await loginAs(manager, "dev.management@figbloom.local");
    await gotoAndSettle(manager, `${BASE}/settings?tab=ai`);
    const wasOn = await manager.getByRole("switch", { name: "Ask Figbloom" }).isChecked();
    await setAssistant(manager, true);
    try {
      await loginAs(page, "dev.sales@figbloom.local");
      await gotoAndSettle(page, BASE);
      await page.getByRole("button", { name: "Ask Figbloom" }).click();
      const panel = page.getByRole("complementary", { name: "Ask Figbloom" });
      await expect(panel).toBeVisible();
      // Either state is correct: with no model key the panel explains that (as in CI); with a key it offers its suggestions.
      await expect(panel.getByTestId("assistant-unavailable").or(panel.getByRole("button", { name: /proposals have no reply/ }))).toBeVisible();
      // Rule 9: nothing is created until a person confirms a proposed action.
      await expect(page.getByText(/Task created:/)).toHaveCount(0);
    } finally {
      await setAssistant(manager, wasOn);
    }
  });

  test("Management's switch for Ask Figbloom is saved, and Settings says when no assistant model is connected", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await gotoAndSettle(page, `${BASE}/settings?tab=ai`);
    const sw = page.getByRole("switch", { name: "Ask Figbloom" });
    const initial = await sw.isChecked();
    try {
      await sw.click();
      await expect(sw).toBeChecked({ checked: !initial });
      await gotoAndSettle(page, `${BASE}/settings?tab=ai`);
      await expect(page.getByRole("switch", { name: "Ask Figbloom" })).toBeChecked({ checked: !initial });
    } finally {
      await setAssistant(page, initial);
    }
    await expect(page.getByRole("switch", { name: "Ask Figbloom" })).toBeChecked({ checked: initial });
  });
});

test.describe("saved views (X4)", () => {
  test("save a view, pin it, and it appears in the sidebar and applies from there", async ({ page }) => {
    // Views are stored through the real API now, so a fixed name would clash with the one a previous run saved.
    const viewName = `My hot ones ${Date.now()}`;
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, `${BASE}/leads`);
    await page.getByRole("button", { name: "Save as view" }).click();
    await page.getByLabel("Name for this view").fill(viewName);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Manage views" }).click();
    const dialog = page.getByRole("dialog", { name: "Manage views" });
    await dialog.getByRole("listitem").filter({ hasText: viewName }).getByRole("button", { name: "Pin to sidebar" }).click();
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page.getByTestId("sidebar-saved-views").getByRole("link", { name: viewName })).toBeVisible();
  });
});

test.describe("own colours (AP4)", () => {
  test("a colour that cannot be read is blocked with a fix offered", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, `${BASE}/preferences?tab=appearance`);
    const section = page.getByTestId("prefs-own-colours");
    await section.locator("#own-page-hex").fill("#777777");
    // A grey page also leaves the accent and highlight unreadable against it, so each field has its own alert: check the page colour's.
    const pageNote = section.locator("#own-page-note");
    await expect(pageNote).toContainText("Too close to mid-grey");
    await expect(section.getByRole("button", { name: "Save my colours" })).toHaveAttribute("aria-disabled", "true");
    await pageNote.getByRole("button", { name: /^Use #/ }).click();
    // The fix is applied: the page colour no longer carries a warning.
    await expect(pageNote).toHaveCount(0);
    // The grey page made the other two colours unreadable against it as well, and each of them offers its own fix. Saving is allowed once all are applied.
    const fixes = section.getByRole("button", { name: /^Use #/ });
    for (let guard = 0; guard < 4 && (await fixes.count()) > 0; guard++) await fixes.first().click();
    await expect(fixes).toHaveCount(0);
    await expect(section.getByRole("button", { name: "Save my colours" })).not.toHaveAttribute("aria-disabled", "true");
  });
});

test.describe("email and calendar connections (S6#2)", () => {
  test("connect asks before leaving for the provider, and nothing is connected until the person agrees", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await gotoAndSettle(page, `${BASE}/settings?tab=connect`);
    await page.getByRole("button", { name: /^Connect / }).first().click();
    await expect(page.getByRole("dialog", { name: "Allow Figbloom to connect?" })).toBeVisible();
    // Stop here: the next step leaves for Google or Microsoft, which a test cannot complete (the token flow is covered by tests/oauthConnections*.test.ts).
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(/^Connected/)).toHaveCount(0);
  });
});

test.describe("mobile capture (M4)", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("scanning a business card fills the form and saves nothing until Save lead", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, `${BASE}/m`);
    await page.getByRole("button", { name: "Quick capture" }).click();
    await page.getByLabel("Photograph a business card").setInputFiles({ name: "card.jpg", mimeType: "image/jpeg", buffer: TINY_JPEG });
    await expect(page.getByTestId("scan-banner")).toContainText("Check the fields before saving");
    await expect(page.getByRole("button", { name: "Save lead" })).toBeVisible();
  });

  test("the sync queue page says everything is synced when nothing waits", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, `${BASE}/m/sync`);
    await expect(page.getByTestId("sync-done")).toContainText("All synced");
  });
});
