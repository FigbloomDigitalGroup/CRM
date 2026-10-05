import { expect, test, type Locator } from "@playwright/test";
import { loginAs, uniqueSuffix } from "./helpers";

/** Playwright's typed `selectOption({ label })` only accepts an exact string, not a pattern -- this finds the matching <option>'s value by regex first. */
async function findOptionValueByLabel(select: Locator, labelPattern: RegExp): Promise<string> {
  const options = await select.locator("option").all();
  for (const option of options) {
    const text = await option.textContent();
    if (text && labelPattern.test(text)) {
      const value = await option.getAttribute("value");
      if (value !== null) return value;
    }
  }
  throw new Error(`No <option> matching ${labelPattern} found.`);
}

/**
 * One continuous journey through every CRM-record flow FIG-602 asks for
 * except login (its own spec) and website capture (its own spec, since
 * it's an API-origin event, not something clicked through): create lead
 * -> assign -> convert to deal (inline company/contact, FIG-601) -> move
 * stage -> log activity -> complete task. Chained in one test, as a real
 * user would experience it, rather than split into isolated steps that'd
 * each need to reconstruct the prior state from scratch.
 *
 * Runs as Management (not Sales) specifically so the whole chain is one
 * continuous login: Management holds every permission this flow touches
 * (leads.create/.assign/.convert/.edit.all, companies/contacts.create,
 * deals.edit.all, activities/tasks.create), so there's no need to swap
 * sessions mid-test just to reassign ownership.
 */
test("create lead -> assign -> convert -> move stage -> log activity -> complete task", async ({
  page,
}) => {
  const suffix = uniqueSuffix();
  await loginAs(page, "dev.management@figbloom.local");

  await test.step("create a lead with no company/contact yet", async () => {
    await page.goto("/o/figbloom/leads");
    await page.getByLabel("Notes").fill(`E2E lead ${suffix}`);

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/orgs/figbloom/leads") && r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Create lead" }).click(),
    ]);
    expect(response.ok()).toBe(true);
    const body = await response.json();
    await page.goto(`/o/figbloom/leads/${body.lead.id}`);
  });

  await test.step("assign the lead to a different member", async () => {
    const ownerCard = page.locator(".card", { hasText: "Owner" });
    await expect(ownerCard).toBeVisible();
    const ownerSelect = ownerCard.locator("select");

    const targetValue = await findOptionValueByLabel(ownerSelect, /Dev Sales/);
    // selectOption() only waits for the DOM change event, not the async
    // fetch its onChange handler kicks off -- reloading immediately after
    // raced the POST and reloaded before it reached the server. Wait for
    // the actual response instead.
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => /\/leads\/.+\/assign$/.test(r.url()) && r.request().method() === "POST",
      ),
      ownerSelect.selectOption(targetValue),
    ]);
    expect(response.ok()).toBe(true);

    // Confirm the reassignment actually persisted, not just the <select>'s
    // own optimistic local state.
    await page.reload();
    const selectedLabel = await ownerCard
      .locator("select")
      .evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.textContent);
    expect(selectedLabel).toMatch(/Dev Sales/);
  });

  let dealUrl = "";
  await test.step("convert to a deal, creating a new company inline (FIG-601)", async () => {
    await page.getByLabel("Create a new company").check();
    await page.getByLabel("New company name").fill(`E2E Inline Co ${suffix}`);
    await page.getByRole("button", { name: "Convert to deal" }).click();
    await page.waitForURL(/\/o\/figbloom\/deals\//);
    dealUrl = page.url();
    await expect(page.getByText(`E2E Inline Co ${suffix}`)).toBeVisible();
  });

  await test.step("move the deal to the next pipeline stage", async () => {
    await page.goto(dealUrl);
    const stageSelect = page.locator("form", { hasText: "Stage" }).locator("select").first();
    const options = await stageSelect.locator("option").allTextContents();
    const nextStage = options[1] ?? options[0];
    await stageSelect.selectOption({ label: nextStage! });
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(nextStage!, { exact: false }).first()).toBeVisible();
  });

  await test.step("log an activity against the deal", async () => {
    await page.goto(dealUrl);
    const activitySubject = `E2E activity ${suffix}`;
    // "Subject" also appears on this page's Communication forms -- scope
    // to the Activity timeline card specifically to avoid an ambiguous
    // (strict-mode-violating) match.
    const activityCard = page.locator(".card", { hasText: "Activity timeline" });
    await activityCard.getByLabel("Subject").fill(activitySubject);
    await activityCard.getByRole("button", { name: "Log activity" }).click();
    await expect(page.getByText(activitySubject)).toBeVisible();
  });

  await test.step("create and complete a task against the deal", async () => {
    await page.goto(dealUrl);
    const taskTitle = `E2E task ${suffix}`;
    const taskCard = page.locator(".card", { hasText: "Tasks" });
    await taskCard.getByLabel("Title").fill(taskTitle);
    await taskCard.getByRole("button", { name: "Create task" }).click();

    const taskRow = page.getByRole("row", { name: new RegExp(taskTitle) });
    await expect(taskRow).toBeVisible();
    await taskRow.locator("select").selectOption("COMPLETED");
    await page.reload();
    await expect(taskRow.locator("select")).toHaveValue("COMPLETED");
  });
});
