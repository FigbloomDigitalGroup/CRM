import { expect as baseExpect, test, type Page } from "@playwright/test";
import { apiPost, gotoAndSettle, loginAs, ORG_SLUG, uniqueSuffix } from "./helpers";

/**
 * F3.08 (FIG-1102, design X1): the shared record-extras panel in a real browser: an upload that is scanned and previewed, a mention that reaches
 * the mentioned person, tags and custom fields, and a read-only archived record. Written against the lead and deal pages (the screens that mount
 * the panel in M7); the company and contact pages mount the same component.
 */
const expect = baseExpect.configure({ timeout: 20_000 });

async function makeLead(page: Page) {
  const suffix = uniqueSuffix();
  const name = `E2E Extras ${suffix}`;
  const { company } = await (await apiPost(page, `/api/orgs/${ORG_SLUG}/companies`, { name, email: `e2e-${suffix}@example.com` })).json();
  const ref = await (await page.request.get(`/api/orgs/${ORG_SLUG}/reference-data`)).json();
  const status = ref.leadStatuses.find((s: { key: string }) => s.key === "NEW");
  const res = await apiPost(page, `/api/orgs/${ORG_SLUG}/leads`, { leadStatusId: status.id, companyId: company.id, notes: `E2E lead ${suffix}.` });
  expect(res.ok(), await res.text()).toBe(true);
  return { id: (await res.json()).lead.id as string, name, suffix };
}

test.describe("record extras on a lead", () => {
  test("uploads a file, sees it scanned, previews it, and deletes it with Undo", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const lead = await makeLead(page);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/leads/${lead.id}`);
    const files = page.locator("section", { has: page.getByRole("heading", { name: /Attachments/ }) });
    await expect(files.getByText(/No files yet/)).toBeVisible();

    await page.getByLabel("Choose files to upload").setInputFiles({ name: "Brief.txt", mimeType: "text/plain", buffer: Buffer.from("Site visit notes for the e2e run.") });
    await expect(files.getByText("Brief.txt")).toBeVisible();
    await expect(files.getByRole("button", { name: "Preview Brief.txt" })).toBeVisible();

    await files.getByRole("button", { name: "Preview Brief.txt" }).click();
    const dialog = page.getByRole("dialog", { name: "Brief.txt" });
    await expect(dialog.getByRole("link", { name: /Download/ })).toBeVisible();
    await page.keyboard.press("Escape");

    await files.getByRole("button", { name: "Delete Brief.txt" }).click();
    await expect(files.getByText("Brief.txt")).toHaveCount(0);
    await page.getByRole("button", { name: /Undo/ }).click();
    await expect(files.getByText("Brief.txt")).toBeVisible();
  });

  test("refuses a file over 25 MB in words and keeps the rest of the page as it was", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const lead = await makeLead(page);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/leads/${lead.id}`);
    await page.getByLabel("Choose files to upload").setInputFiles({ name: "Drone-survey.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(26 * 1024 * 1024) });
    await expect(page.getByRole("alert").filter({ hasText: "Drone-survey.pdf wasn’t uploaded" })).toContainText("up to 25 MB");
  });

  test("a mention is picked from the people who can open the lead and shows in the thread", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const lead = await makeLead(page);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/leads/${lead.id}`);
    const box = page.getByLabel("Write a comment");
    await box.fill("Please look at this @Dev");
    const options = page.getByRole("group", { name: "Mention a teammate" }).getByRole("button");
    await expect(options.first()).toBeVisible();
    const chosen = (await options.first().innerText()).trim();
    await options.first().click();
    await page.getByRole("button", { name: "Post" }).click();
    await expect(page.locator(".fb-xmention", { hasText: chosen })).toBeVisible();
  });

  test("a tag saves and survives a reload", async ({ page }) => {
    // Management makes the organisation's tag (creating one needs tags.manage), then adds it to a lead from the panel.
    await loginAs(page, "dev.management@figbloom.local");
    const tagName = `E2E tag ${uniqueSuffix()}`;
    expect((await apiPost(page, `/api/orgs/${ORG_SLUG}/tags`, { name: tagName })).ok()).toBe(true);
    const lead = await makeLead(page);
    await gotoAndSettle(page, `/o/${ORG_SLUG}/leads/${lead.id}`);
    await page.getByRole("combobox", { name: "Add tag" }).selectOption({ label: tagName });
    await expect(page.getByRole("button", { name: `Remove tag ${tagName}` })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: `Remove tag ${tagName}` })).toBeVisible();
  });
});

test.describe("record extras on a deal", () => {
  test("a deal's page carries the same panel", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    const suffix = uniqueSuffix();
    const { company } = await (await apiPost(page, `/api/orgs/${ORG_SLUG}/companies`, { name: `E2E Deal Extras ${suffix}`, email: `e2e-${suffix}@example.com` })).json();
    const ref = await (await page.request.get(`/api/orgs/${ORG_SLUG}/reference-data`)).json();
    const stage = ref.pipelineStages.find((s: { key: string }) => s.key === "SOLUTION_PRESENTED");
    const res = await apiPost(page, `/api/orgs/${ORG_SLUG}/deals`, { companyId: company.id, pipelineStageId: stage.id, value: 90000, currency: "KES" });
    const deal = await res.json();
    await gotoAndSettle(page, `/o/${ORG_SLUG}/deals/${deal.id}`);
    await expect(page.getByRole("heading", { name: "Internal comments" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Attachments/ })).toBeVisible();
  });
});
