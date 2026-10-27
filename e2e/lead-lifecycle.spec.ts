import { expect, test } from "@playwright/test";
import { gotoAndSettle, loginAs, uniqueSuffix } from "./helpers";

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

  let leadUrl = "";
  await test.step("create a lead from the New lead drawer (F2.01, F2.03)", async () => {
    await gotoAndSettle(page, "/o/figbloom/leads");
    await page.getByRole("button", { name: "New lead" }).first().click();
    const drawer = page.getByRole("dialog", { name: "New lead" });
    await drawer.getByRole("combobox", { name: /Company or person/ }).fill(`E2E Inline Co ${suffix}`);
    await drawer.getByLabel("Notes").fill(`E2E lead ${suffix}`);
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/orgs/figbloom/leads") && r.request().method() === "POST"),
      drawer.getByRole("button", { name: /Create lead/ }).click(),
    ]);
    expect(response.ok()).toBe(true);
    const body = await response.json();
    await page.waitForURL(`**/leads/${body.lead.id}`);
    leadUrl = page.url();
    await expect(page.getByRole("heading", { level: 1, name: `E2E Inline Co ${suffix}` })).toBeVisible();
  });

  await test.step("assign the lead to a different member, from the lead page (F2.02)", async () => {
    const owner = page.getByRole("combobox", { name: /^Owner/ });
    await expect(owner).toBeEnabled();
    const [response] = await Promise.all([
      page.waitForResponse((r) => /\/leads\/.+\/assign$/.test(r.url()) && r.request().method() === "POST"),
      owner.selectOption({ label: "Dev Sales (Sales)" }),
    ]);
    expect(response.ok()).toBe(true);
    // Confirm the reassignment actually persisted, not just the select's own local state.
    await page.reload();
    await expect(page.getByRole("combobox", { name: /^Owner/ }).locator("option:checked")).toHaveText(/^Dev Sales/);
  });

  let dealUrl = "";
  await test.step("convert to a deal from the Convert dialog (F2.03)", async () => {
    await page.goto(leadUrl);
    await page.getByRole("button", { name: "Convert to deal" }).first().click();
    const dialog = page.getByRole("dialog", { name: /^Convert .* to a deal$/ });
    await expect(dialog.getByText("Existing company found · linked")).toBeVisible();
    await dialog.getByRole("button", { name: "Convert to deal" }).click();
    await page.waitForURL(/\/o\/figbloom\/deals\//);
    dealUrl = page.url();
    await expect(page.getByText(`E2E Inline Co ${suffix}`).first()).toBeVisible();
  });

  await test.step("move the deal to the next pipeline stage, from its page (F2.05)", async () => {
    await page.goto(dealUrl);
    const steps = page.getByRole("region", { name: "Deal stages" });
    const next = steps.locator("button:not([disabled])").first();
    const nextStage = (await next.innerText()).trim();
    await next.click();
    await expect(steps.getByRole("button", { name: nextStage })).toHaveAttribute("aria-current", "step");
  });

  await test.step("drag the deal to another stage on the board and put it back with Undo (FIG-790)", async () => {
    await gotoAndSettle(page, "/o/figbloom/deals");
    const card = page.locator(".fb-dcard", { hasText: `E2E Inline Co ${suffix}` });
    await expect(card).toBeVisible();
    const from = await card.locator("xpath=ancestor::div[@role='group'][1]").getAttribute("aria-label");
    // Proposal Sent needs no proposal reference to enter and Negotiation does, so the drag goes to whichever of the first two stages the deal is not in.
    const target = from?.startsWith("Solution Presented") ? /^Proposal Sent, \d+ deals?$/ : /^Solution Presented, \d+ deals?$/;
    await card.dragTo(page.getByRole("group", { name: target }), { targetPosition: { x: 120, y: 40 } });
    await expect(page.getByRole("group", { name: target }).locator(".fb-dcard", { hasText: `E2E Inline Co ${suffix}` })).toBeVisible();
    await page.getByRole("button", { name: /Undo/ }).click();
    await expect(page.getByRole("group", { name: from! }).locator(".fb-dcard", { hasText: `E2E Inline Co ${suffix}` })).toBeVisible();
  });

  await test.step("log an activity against the deal", async () => {
    await page.goto(dealUrl);
    const activitySubject = `E2E activity ${suffix}`;
    await page.getByRole("button", { name: "Log activity" }).first().click();
    const drawer = page.getByRole("dialog", { name: "Log a call or note" });
    await drawer.getByRole("button", { name: "Note" }).click();
    await drawer.getByLabel("Note").fill(activitySubject);
    await drawer.getByRole("button", { name: "Log it" }).click();
    await expect(page.getByText(activitySubject)).toBeVisible();
  });

  await test.step("create a task against the deal, and complete it", async () => {
    await page.goto(dealUrl);
    const taskTitle = `E2E task ${suffix}`;
    await page.getByRole("button", { name: "+ Add task" }).click();
    const drawer = page.getByRole("dialog", { name: "New task" });
    await drawer.getByLabel(/^Title/).fill(taskTitle);
    await drawer.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByText(taskTitle)).toBeVisible();

    // A deal's page lists the open tasks; completing one is a Tasks-page action (T1), so it is completed through the same API that page uses
    // and the deal's list then no longer shows it.
    const open = await (await page.request.get(`/api/orgs/figbloom/tasks?dealId=${dealUrl.split("/").pop()}`)).json();
    const task = open.items.find((x: { title: string }) => x.title === taskTitle);
    expect(task).toBeTruthy();
    const done = await page.request.patch(`/api/orgs/figbloom/tasks/${task.id}`, { data: { status: "COMPLETED" }, headers: { origin: new URL(page.url()).origin } });
    expect(done.ok()).toBe(true);
    await page.reload();
    await expect(page.getByText(taskTitle)).toHaveCount(0);
  });
});
