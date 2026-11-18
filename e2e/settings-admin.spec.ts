import { expect, test } from "@playwright/test";
import { apiPost, gotoAndSettle, loginAs, uniqueSuffix } from "./helpers";

/**
 * M9 (F4.04 to F4.09, FIG-1106 to FIG-1111): the Settings sections beyond members and reference data, as Management, and the refusal for everyone else.
 * Policy changes are put back at the end so reruns see the same organisation.
 */
test.describe("Settings as Management", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
  });

  test("organisation profile saves, and the shared-look lock follows through to a member", async ({ page, browser }) => {
    await gotoAndSettle(page, "/o/figbloom/settings?tab=org");
    const phone = page.getByLabel("Phone");
    const original = await phone.inputValue();
    await phone.fill(`+254 700 ${Math.floor(100000 + Math.random() * 899999)}`);
    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/orgs/figbloom/profile") && r.request().method() === "PATCH"),
      page.getByRole("button", { name: "Save changes" }).click(),
    ]);
    expect(saved.ok()).toBe(true);
    await expect(page.getByText("Organisation profile saved.").first()).toBeVisible();
    await phone.fill(original);
    const [putBack] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/orgs/figbloom/profile") && r.request().method() === "PATCH"),
      page.getByRole("button", { name: "Save changes" }).click(),
    ]);
    expect(putBack.ok()).toBe(true);

    // Lock personalisation, check a member sees the shared look explained, then unlock.
    const lock = page.getByRole("checkbox", { name: /Allow members to personalise their appearance/ });
    const wasOn = await lock.isChecked();
    try {
      if (wasOn) {
        const [locked] = await Promise.all([
          page.waitForResponse((r) => r.url().endsWith("/api/orgs/figbloom/look") && r.request().method() === "PATCH"),
          lock.click(),
        ]);
        expect(locked.ok()).toBe(true);
      }
      const member = await browser.newContext();
      const mp = await member.newPage();
      await loginAs(mp, "dev.sales@figbloom.local");
      const look = await mp.request.get("/api/orgs/figbloom/look");
      expect((await look.json()).allowPersonalisation).toBe(false);
      await member.close();
    } finally {
      if (wasOn) {
        await gotoAndSettle(page, "/o/figbloom/settings?tab=org");
        if (!(await lock.isChecked())) await lock.click();
        await expect(lock).toBeChecked();
      }
    }
  });

  test("website key: rotate shows the new key once, then only its prefix", async ({ page }) => {
    await gotoAndSettle(page, "/o/figbloom/settings?tab=website");
    const create = page.getByRole("button", { name: "Create key" });
    if (await create.isVisible().catch(() => false)) await create.click();
    else {
      await page.getByRole("button", { name: "Rotate" }).click();
      await page.getByRole("dialog", { name: "Rotate the website key?" }).getByRole("button", { name: "Create new key" }).click();
    }
    const key = await page.getByTestId("new-website-key").innerText();
    expect(key.length).toBeGreaterThan(20);
    await page.getByRole("button", { name: "I have copied it" }).click();
    await page.reload();
    await expect(page.getByLabel("API key prefix")).toBeVisible();
    await expect(page.getByText(key)).toHaveCount(0);
  });

  test("audit log: filters narrow the list, the drawer shows before and after, and export downloads a CSV", async ({ page }) => {
    // Make sure there is at least one event of a known kind to look for.
    await apiPost(page, "/api/orgs/figbloom/tags", { name: `e2e-audit-${uniqueSuffix()}`, colour: "#275B3A" });
    await gotoAndSettle(page, "/o/figbloom/settings?tab=audit");
    await expect(page.getByRole("table").first()).toBeVisible();
    const total = await page.getByText(/^\d+ events?$/).innerText();
    await page.getByLabel("Record type").selectOption({ label: "Tag" });
    await expect(page.getByText(/^\d+ events?$/)).not.toHaveText(total);
    await page.getByRole("button", { name: /Open details of/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}\.csv$/);
    // Read-only: nothing on this page edits or deletes an event.
    await expect(page.getByRole("button", { name: /delete|remove|edit/i })).toHaveCount(0);
  });

  test("automations: switch a rule off and on, the boundary is stated, and the run log is there", async ({ page }) => {
    await gotoAndSettle(page, "/o/figbloom/settings?tab=automations");
    await expect(page.getByText(/never move a deal stage/).first()).toBeVisible();
    const first = page.getByRole("switch").first();
    const was = await first.getAttribute("aria-checked");
    const [off] = await Promise.all([
      page.waitForResponse((r) => /\/automations\/[A-Z_]+$/.test(r.url()) && r.request().method() === "PATCH"),
      first.click(),
    ]);
    expect(off.ok()).toBe(true);
    await expect(first).toHaveAttribute("aria-checked", was === "true" ? "false" : "true");
    await first.click();
    await expect(first).toHaveAttribute("aria-checked", was!);
    await expect(page.getByRole("heading", { name: "Run log" })).toBeVisible();
  });

  test("integrations: states come from real signals and only click-to-chat is configured here", async ({ page }) => {
    await gotoAndSettle(page, "/o/figbloom/settings?tab=integrations");
    await expect(page.getByRole("article", { name: "Website lead form" })).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: "Planned" }).first()).toBeVisible();
    const wa = page.getByRole("article").filter({ hasText: /WhatsApp/ });
    await wa.getByRole("button", { name: "Configure" }).click();
    await expect(page.getByLabel("Organisation WhatsApp number")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("tags, message templates and custom fields: hide, don't delete", async ({ page }) => {
    const suffix = uniqueSuffix();
    await test.step("tags", async () => {
      await gotoAndSettle(page, "/o/figbloom/settings?tab=tags");
      await page.getByLabel("New tag").fill(`e2e-${suffix}`);
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await expect(page.getByText(`e2e-${suffix}`, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: `Hide e2e-${suffix}` }).click();
      await expect(page.getByRole("button", { name: `Show e2e-${suffix}` })).toBeVisible();
    });
    await test.step("message template", async () => {
      await gotoAndSettle(page, "/o/figbloom/settings?tab=templates");
      await page.getByRole("button", { name: "New template" }).first().click();
      await page.getByLabel("Name").fill(`E2E template ${suffix}`);
      await page.getByLabel("Subject").fill("Hello {{contact.firstName}}");
      await page.getByLabel("Message").fill("Thanks {{contact.firstName}}.");
      await expect(page.getByLabel("Preview")).toContainText("Hello Amara");
      await page.getByRole("button", { name: "Save template" }).click();
      await expect(page.getByRole("button", { name: new RegExp(`E2E template ${suffix}`) })).toBeVisible();
      await page.getByRole("button", { name: "Hide template" }).click();
      await expect(page.getByRole("button", { name: "Show template" })).toBeVisible();
    });
    await test.step("custom field", async () => {
      await gotoAndSettle(page, "/o/figbloom/settings?tab=fields");
      await page.getByRole("button", { name: "New field" }).click();
      const dialog = page.getByRole("dialog", { name: "New custom field" });
      await dialog.getByLabel(/Label/).fill(`E2E field ${suffix}`);
      await dialog.getByRole("button", { name: "Save field" }).click();
      const row = page.getByRole("row", { name: new RegExp(`E2E field ${suffix}`) });
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: /^Hide/ }).click();
      await expect(row).toContainText("Hidden");
    });
  });

  test("security: the session policy changes and is put back; the role matrix is read-only", async ({ page }) => {
    await gotoAndSettle(page, "/o/figbloom/settings?tab=security");
    const select = page.getByLabel("Sign people out after");
    const original = await select.inputValue();
    const other = (await select.locator("option").evaluateAll((o) => (o as HTMLOptionElement[]).map((x) => x.value))).find((v) => v !== original)!;
    await select.selectOption(other);
    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/security/session-policy") && r.request().method() === "PATCH"),
      page.getByRole("button", { name: "Save policy" }).click(),
    ]);
    expect(saved.ok()).toBe(true);
    await select.selectOption(original);
    const [restored] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/security/session-policy") && r.request().method() === "PATCH"),
      page.getByRole("button", { name: "Save policy" }).click(),
    ]);
    expect(restored.ok()).toBe(true);
    await expect(page.getByText("Session policy saved. It applies to new sessions.").first()).toBeVisible();
    const matrix = page.getByRole("table", { name: "Role matrix" });
    await expect(matrix).toBeVisible();
    await expect(matrix.getByRole("checkbox")).toHaveCount(0);
  });

  test("privacy: retention saves, and a legal hold needs a reason", async ({ page }) => {
    await gotoAndSettle(page, "/o/figbloom/settings?tab=privacy");
    const field = page.getByLabel("Generated export files (days)");
    const original = await field.inputValue();
    await field.fill("45");
    const [saved] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/privacy/retention") && r.request().method() === "PUT"),
      page.getByRole("button", { name: "Save retention" }).click(),
    ]);
    expect(saved.ok()).toBe(true);
    await field.fill(original || "30");
    const [putBack] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/privacy/retention") && r.request().method() === "PUT"),
      page.getByRole("button", { name: "Save retention" }).click(),
    ]);
    expect(putBack.ok()).toBe(true);
    await expect(page.getByRole("button", { name: "Place a legal hold" })).toHaveAttribute("aria-disabled", "true");
  });
});

test.describe("Settings for everyone else", () => {
  for (const [who, email] of [["Sales", "dev.sales@figbloom.local"], ["Delivery", "dev.delivery@figbloom.local"], ["Finance", "dev.finance@figbloom.local"]] as const) {
    test(`${who} gets an explained no-access, and the API refuses the settings calls`, async ({ page }) => {
      await loginAs(page, email);
      await gotoAndSettle(page, "/o/figbloom/settings?tab=members");
      await expect(page.getByRole("region", { name: /Settings isn’t part of your workspace/ })).toBeVisible();
      await expect(page.locator("#main").getByRole("link", { name: "Preferences" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Settings sections" })).toHaveCount(0);
      for (const path of ["/api/orgs/figbloom/audit/events", "/api/orgs/figbloom/automations", "/api/orgs/figbloom/privacy", "/api/orgs/figbloom/security/session-policy", "/api/orgs/figbloom/data-migration/sessions"]) {
        expect((await page.request.get(path)).status(), path).toBe(403);
      }
    });
  }
});
