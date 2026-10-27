import { expect, test, type Page } from "@playwright/test";
import { apiPost, gotoAndSettle, loginAs, ORG_SLUG, uniqueSuffix } from "./helpers";

/**
 * F2.01 to F2.03 (FIG-1083, 1084, 1085, design L1 to L3): the Leads list, the lead page and the quick actions, in a real browser, per role.
 * Every spec makes its own records (named with a suffix) so the persistent local database is never relied on to hold anything in particular.
 */

const SALES = "dev.sales@figbloom.local";
const MANAGEMENT = "dev.management@figbloom.local";
const FINANCE = "dev.finance@figbloom.local";

async function reference(page: Page) {
  const res = await page.request.get(`/api/orgs/${ORG_SLUG}/reference-data`);
  return (await res.json()) as {
    leadStatuses: { id: string; key: string; name: string }[];
    services: { id: string; key: string; name: string }[];
    members: { membershipId: string; userEmail: string; userName: string }[];
  };
}

/** A lead made through the API (so a spec about one flow does not depend on another), as the signed-in person. */
async function makeLead(page: Page, over: Record<string, unknown> = {}, companyName?: string) {
  const ref = await reference(page);
  let companyId: string | undefined;
  if (companyName) {
    const c = await apiPost(page, `/api/orgs/${ORG_SLUG}/companies`, { name: companyName });
    expect(c.ok()).toBe(true);
    companyId = (await c.json()).company.id;
  }
  const res = await apiPost(page, `/api/orgs/${ORG_SLUG}/leads`, { leadStatusId: ref.leadStatuses.find((s) => s.key === "NEW")!.id, companyId, ...over });
  expect(res.ok()).toBe(true);
  return { id: (await res.json()).lead.id as string, ref };
}

test.describe("the Leads list, per role", () => {
  test("Sales sees their own leads, the shared pool as provisional, and cannot reassign (with the reason)", async ({ page }) => {
    const suffix = uniqueSuffix();
    await loginAs(page, SALES);
    await makeLead(page, {}, `E2E Sales Co ${suffix}`);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/leads`);
    await expect(page.getByRole("heading", { level: 1, name: "Leads" })).toBeVisible();
    await expect(page.getByText(/^My leads/)).toBeVisible();
    await expect(page.getByText("You can edit, convert and archive leads you own. Reassigning is Management only.")).toBeVisible();
    await expect(page.getByRole("tab", { name: /Shared pool/ })).toContainText("PROVISIONAL");
    await expect(page.getByRole("link", { name: `E2E Sales Co ${suffix}` })).toBeVisible();
    // The owner is plain text with a lock and the reason, never a select, for someone who cannot reassign.
    await expect(page.getByRole("combobox", { name: /Owner of/ })).toHaveCount(0);
    await expect(page.getByText("Only Management can reassign leads").first()).toBeAttached();
    await expect(page.getByRole("button", { name: "Export CSV" })).toHaveCount(0);
  });

  test("Management sees the whole organisation, Import and Export, and an Unassigned tab", async ({ page }) => {
    await loginAs(page, MANAGEMENT);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/leads`);
    await expect(page.getByText(/^All organisation leads/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Import CSV" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Unassigned/ })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Owner", exact: true })).toBeVisible(); // the owner filter
  });

  test("a role with no access to leads gets the explained no-access, not a blank page", async ({ page }) => {
    await loginAs(page, FINANCE);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/leads`);
    await expect(page.getByText(/isn.t part of your workspace|can.t see|not available|aren.t available|no access/i).first()).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("searching, filtering and clearing work on the server, and the URL's ?q= is honoured", async ({ page }) => {
    const suffix = uniqueSuffix();
    await loginAs(page, MANAGEMENT);
    await makeLead(page, {}, `E2E Findable ${suffix}`);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/leads?q=${encodeURIComponent(`Findable ${suffix}`)}`);
    await expect(page.getByRole("link", { name: `E2E Findable ${suffix}` })).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search leads" })).toHaveValue(`Findable ${suffix}`);
    await page.getByRole("searchbox", { name: "Search leads" }).fill(`nothing-matches-${suffix}`);
    await expect(page.getByText("No leads match these filters")).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByRole("table").getByRole("row").nth(1)).toBeVisible();
  });
});

test.describe("creating, archiving and restoring", () => {
  test("Sales creates a lead from the drawer with only a name, and lands on the new lead", async ({ page }) => {
    const suffix = uniqueSuffix();
    await loginAs(page, SALES);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/leads`);
    await page.getByRole("button", { name: "New lead" }).first().click();
    const drawer = page.getByRole("dialog", { name: "New lead" });
    await expect(drawer.getByText("Capture now, qualify later.")).toBeVisible();
    await expect(drawer.getByRole("button", { name: /Create lead/ })).toBeDisabled();
    await expect(drawer.getByRole("combobox", { name: /^Owner/ })).toBeDisabled(); // a salesperson's lead is theirs
    await drawer.getByRole("combobox", { name: /Company or person/ }).fill(`E2E Drawer Co ${suffix}`);
    await drawer.getByRole("button", { name: "Hot" }).click();
    await drawer.getByRole("button", { name: /Create lead/ }).click();
    await page.waitForURL(new RegExp(`/o/${ORG_SLUG}/leads/[0-9a-f-]+$`));
    await expect(page.getByRole("heading", { level: 1, name: `E2E Drawer Co ${suffix}` })).toBeVisible();
    await expect(page.getByText("HOT", { exact: true }).first()).toBeVisible();
  });

  test("a lead is archived with an Undo, then shows on the Archived tab with Restore", async ({ page }) => {
    const suffix = uniqueSuffix();
    await loginAs(page, MANAGEMENT);
    await makeLead(page, {}, `E2E Archive Co ${suffix}`);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/leads?q=${encodeURIComponent(`Archive Co ${suffix}`)}`);
    await page.getByRole("button", { name: `Archive E2E Archive Co ${suffix}` }).click();
    await expect(page.getByText(`E2E Archive Co ${suffix} archived`)).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("link", { name: `E2E Archive Co ${suffix}` })).toBeVisible();
    // Archive again for real and restore it from the Archived tab.
    await page.getByRole("button", { name: `Archive E2E Archive Co ${suffix}` }).click();
    await expect(page.getByText("No leads match these filters")).toBeVisible();
    await page.getByRole("tab", { name: /Archived/ }).click();
    const row = page.getByRole("row", { name: new RegExp(`E2E Archive Co ${suffix}`) });
    await expect(row.getByRole("button", { name: "Restore" })).toBeVisible();
    await expect(row.getByRole("button", { name: /^Edit/ })).toHaveCount(0); // archived is read-only
    await row.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText(`E2E Archive Co ${suffix} restored`)).toBeVisible();
  });

  test("bulk actions: select two leads, reassign them, and the bar goes away", async ({ page }) => {
    const suffix = uniqueSuffix();
    await loginAs(page, MANAGEMENT);
    const a = await makeLead(page, {}, `E2E Bulk A ${suffix}`);
    await makeLead(page, {}, `E2E Bulk B ${suffix}`);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/leads?q=${suffix}`);
    await page.getByRole("checkbox", { name: `Select E2E Bulk A ${suffix}` }).check();
    await page.getByRole("checkbox", { name: `Select E2E Bulk B ${suffix}` }).check();
    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar.getByText("2 selected")).toBeVisible();
    const sales = a.ref.members.find((m) => m.userEmail === SALES)!;
    await bar.getByRole("combobox", { name: "Reassign selected to" }).selectOption(sales.membershipId);
    await expect(page.getByText(/2 leads reassigned to Dev Sales/)).toBeVisible();
    await expect(bar).toHaveCount(0);
  });
});

test.describe("the lead page", () => {
  test("a lead cannot be marked Qualified until the required answers are in, and the page says exactly what is missing", async ({ page }) => {
    test.setTimeout(90_000); // every earlier run left one more required question on this service, and each answer is saved in turn
    const suffix = uniqueSuffix();
    await loginAs(page, MANAGEMENT);
    const ref = await reference(page);
    // A required-on-qualify question for one service only, so no other lead in the shared database is affected.
    const service = ref.services[ref.services.length - 1]!;
    const key = `e2e_${suffix.replace(/\D/g, "")}`;
    const def = await apiPost(page, `/api/orgs/${ORG_SLUG}/custom-fields`, { entityType: "LEAD", key, label: `E2E question ${suffix}`, fieldType: "TEXT", section: "QUALIFICATION", requiredOnQualify: true, serviceId: service.id });
    expect(def.ok()).toBe(true);
    const { id } = await makeLead(page, { serviceInterestId: service.id }, `E2E Qualify Co ${suffix}`);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/leads/${id}`);
    const strip = page.getByRole("region", { name: "Lead progress" });
    await expect(strip.getByRole("button", { name: /Qualified/ })).toBeVisible();
    await strip.getByRole("button", { name: /Qualified/ }).click();
    const alert = page.getByRole("alert").filter({ hasText: "can’t be marked Qualified yet" });
    await expect(alert).toContainText(`E2E question ${suffix}`);
    // Answer it (saved as you type) and the move now succeeds.
    // Earlier runs against this shared database leave their own required questions on the service: answer every one the page still asks for.
    const stillAsked = page.getByRole("region", { name: /^Qualification/ }).locator("[aria-invalid=true]");
    // Whatever else the service asks (a seeded choice, or a question an earlier run left behind): answer each, by its kind.
    for (const box of await stillAsked.all()) {
      if ((await box.evaluate((e) => e.tagName)) === "SELECT") await box.selectOption({ index: 1 });
      else await box.fill("Answered");
    }
    await expect(page.getByText(/saved$/)).toBeVisible();
    await expect(page.getByRole("region", { name: /^Qualification/ }).locator("[aria-invalid=true]")).toHaveCount(0, { timeout: 45_000 }); // the page has re-read what is still missing
    await strip.getByRole("button", { name: /Qualified/ }).click();
    // The move is a server write and a re-read: allow for a slow runner.
    await expect(strip.getByRole("button", { name: /Qualified/ })).toHaveAttribute("aria-current", "step", { timeout: 20_000 });
  });

  test("Mark lost needs a reason, and the lost reason is then shown on the lead", async ({ page }) => {
    const suffix = uniqueSuffix();
    await loginAs(page, MANAGEMENT);
    const { id } = await makeLead(page, {}, `E2E Lost Co ${suffix}`);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/leads/${id}`);
    await page.getByRole("button", { name: "Mark lost" }).click();
    const dialog = page.getByRole("dialog", { name: /Why was .* lost\?/ });
    await expect(dialog.getByRole("button", { name: "Mark lost" })).toBeDisabled();
    await dialog.getByRole("group", { name: "Lost reason" }).getByRole("button").first().click();
    await dialog.getByRole("button", { name: "Mark lost" }).click();
    await expect(page.getByText("Lost reason", { exact: true })).toBeVisible();
  });

  test("convert: a lead with no company gets one created inline, and the lead page locks afterwards", async ({ page }) => {
    const suffix = uniqueSuffix();
    await loginAs(page, MANAGEMENT);
    const { id } = await makeLead(page, {});
    await gotoAndSettle(page, `/o/${ORG_SLUG}/leads/${id}`);
    await page.getByRole("button", { name: "Convert to deal" }).first().click();
    const dialog = page.getByRole("dialog", { name: /^Convert .* to a deal$/ });
    await expect(dialog.getByText("No match found · will be created")).toBeVisible();
    await dialog.getByRole("textbox", { name: /Company name/ }).fill(`E2E Inline Co ${suffix}`);
    await dialog.getByRole("button", { name: "Convert to deal" }).click();
    await page.waitForURL(/\/o\/figbloom\/deals\//);
    await page.goto(`/o/${ORG_SLUG}/leads/${id}`);
    const strip = page.getByRole("region", { name: "Lead progress" });
    await expect(strip.getByRole("button", { name: /Converted/ })).toBeVisible();
    for (const b of await strip.getByRole("button").all()) await expect(b).toBeDisabled();
    await expect(page.getByRole("button", { name: "Convert to deal" })).toHaveCount(0);
  });
});

test.describe("import and export", () => {
  test("import: map the columns, import, and get a usable report for the rows that did not come in", async ({ page }) => {
    const suffix = uniqueSuffix();
    await loginAs(page, MANAGEMENT);
    // The API imports a lead against a company that already exists (it never creates one from a CSV row), so the two good rows name companies that do.
    for (const n of ["One", "Two"]) expect((await apiPost(page, `/api/orgs/${ORG_SLUG}/companies`, { name: `E2E Import ${n} ${suffix}` })).ok()).toBe(true);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/leads`);
    await page.getByRole("button", { name: "Import CSV" }).first().click();
    // The dialog is renamed by its step ("Check the columns", then the result), so it is found by role alone once it is open.
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Drop a .csv file here")).toBeVisible();
    const csv = ["name,phone,email,source,service", `E2E Import One ${suffix},+254700000011,one.${suffix}@example.com,Phone,`, `E2E Import Two ${suffix},+254700000012,two.${suffix}@example.com,Website,`, `E2E Ghost ${suffix},+254700000013,,,`].join("\n");
    await dialog.locator('input[type="file"]').setInputFiles({ name: "leads.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(dialog.getByRole("heading", { name: "Check the columns" })).toBeVisible();
    await expect(dialog.getByLabel("Company or person")).toHaveValue("name");
    await dialog.getByRole("button", { name: /Import 3 rows/ }).click();
    await expect(dialog.getByText(/of 3 rows imported\./)).toBeVisible();
    await expect(dialog.getByRole("list", { name: "Rows that need a look" })).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: /Download error report/ }).click()]);
    expect(download.suggestedFilename()).toBe("lead-import-errors.csv");
    await dialog.getByRole("button", { name: "Done" }).click();
    await page.getByRole("searchbox", { name: "Search leads" }).fill(`Import One ${suffix}`);
    await expect(page.getByRole("link", { name: `E2E Import One ${suffix}` })).toBeVisible();
  });

  test("import says plainly when a file cannot be read", async ({ page }) => {
    await loginAs(page, MANAGEMENT);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/leads`);
    await page.getByRole("button", { name: "Import CSV" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Import leads from CSV" });
    await dialog.locator('input[type="file"]').setInputFiles({ name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("not a table") });
    await expect(dialog.getByText("We couldn’t read that file.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Choose another file" })).toBeVisible();
  });

  test("export CSV downloads the current leads", async ({ page }) => {
    await loginAs(page, MANAGEMENT);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/leads`);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^leads-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
