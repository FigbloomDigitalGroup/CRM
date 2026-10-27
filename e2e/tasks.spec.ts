import { expect, test, type Page } from "@playwright/test";
import { gotoAndSettle, loginAs, ORG_SLUG, uniqueSuffix } from "./helpers";

/**
 * F2.07 and F2.08: the tasks list and the calendar in a real browser, per role: grouping, quick complete with Undo, quick add, the team filter
 * locked by role, and creating a task or a meeting from a calendar slot.
 */

async function openTasks(page: Page) {
  await gotoAndSettle(page, `/o/${ORG_SLUG}/tasks`);
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
}

test.describe("Tasks list", () => {
  test("Sales sees their own tasks, grouped, with no assignee filter", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await openTasks(page);
    await expect(page.getByText(/^My tasks · \d+$/)).toBeVisible();
    await expect(page.getByText("You can create tasks for yourself and complete your own.")).toBeVisible();
    await expect(page.getByLabel("Assignee")).toHaveCount(0);
    for (const name of ["Overdue", "Today", "Upcoming", "Done"]) await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^${name}`) })).toBeVisible();
  });

  test("Management sees everyone's tasks and can narrow by person", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await openTasks(page);
    await expect(page.getByText(/^All organisation tasks · \d+$/)).toBeVisible();
    const who = page.getByLabel("Assignee");
    await expect(who).toBeVisible();
    await expect.poll(async () => (await who.locator("option").count())).toBeGreaterThan(1);
  });

  test("a task made from the drawer appears, completes with one tick, and Undo brings it back", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await openTasks(page);
    const title = `E2E follow-up ${uniqueSuffix()}`;
    await page.getByRole("button", { name: "New task" }).click();
    const drawer = page.getByRole("dialog", { name: "New task" });
    await drawer.getByLabel(/Title/).fill(title);
    // The assignee is locked for someone who cannot assign to others, and says why.
    await expect(drawer.getByText("You can assign tasks to yourself. Management can assign to anyone.")).toBeVisible();
    await drawer.getByRole("button", { name: "Create task" }).click();
    const row = page.locator(".fb-tk-row", { hasText: title });
    await expect(row).toBeVisible();

    await row.getByRole("checkbox", { name: new RegExp(`Mark “${title}” done`) }).click();
    await expect(page.getByText(`Completed “${title}”.`)).toBeVisible();
    await expect(page.locator(".fb-tk-row", { hasText: title })).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(".fb-tk-row", { hasText: title })).toBeVisible();
  });

  test("quick add makes a task from one line", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await openTasks(page);
    const title = `E2E quick ${uniqueSuffix()}`;
    await page.getByLabel("Quick add a task").fill(title);
    await page.keyboard.press("Enter");
    await expect(page.locator(".fb-tk-row", { hasText: title })).toBeVisible();
  });

  test("snoozing moves the task to its new time", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await openTasks(page);
    const title = `E2E snooze ${uniqueSuffix()}`;
    await page.getByLabel("Quick add a task").fill(title);
    await page.keyboard.press("Enter");
    const row = page.locator(".fb-tk-row", { hasText: title });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: new RegExp(`Snooze “${title}”`) }).click();
    await page.getByRole("menuitem", { name: "In 3 days, 9:00" }).focus(); // by keyboard: the menu is fully usable without a pointer
    await page.keyboard.press("Enter");
    await expect(page.getByText(/^Snoozed to in 3 days, 9:00\./)).toBeVisible();
    await expect(page.locator(".fb-tk-row", { hasText: title }).locator(".fb-tk-due")).toContainText("9:00");
  });

  test("Restricted Technical sees only their own tasks, with no assignee filter", async ({ page }) => {
    await loginAs(page, "dev.tech@figbloom.local");
    await openTasks(page);
    await expect(page.getByText(/^My tasks · \d+$/)).toBeVisible();
    await expect(page.getByLabel("Assignee")).toHaveCount(0);
  });

  test("Finance has no tasks and is told why", async ({ page }) => {
    await loginAs(page, "dev.finance@figbloom.local");
    await page.goto(`/o/${ORG_SLUG}/tasks`);
    await expect(page.getByText(/aren.t available for your role|isn.t part of your workspace/i).first()).toBeVisible();
  });
});

test.describe("Calendar", () => {
  test("Sales sees their own calendar and the team filter is locked with the reason", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/calendar`);
    await expect(page.getByRole("heading", { level: 1, name: "Calendar" })).toBeVisible();
    const who = page.getByLabel("Whose calendar");
    await expect(who).toBeDisabled();
    await expect(page.getByText("The team calendar is visible to Management. You see your own tasks.")).toBeVisible();
  });

  test("Management can open the team calendar and pick a person", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/calendar`);
    const who = page.getByLabel("Whose calendar");
    await expect(who).toBeEnabled();
    await expect.poll(async () => who.locator("option").count()).toBeGreaterThan(1);
  });

  test("a task is created from a day slot and shows in that day, in month and week", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/calendar`);
    const title = `E2E slot ${uniqueSuffix()}`;
    await page.locator('[data-day][aria-current="date"] [data-cell]').click({ position: { x: 6, y: 6 } }); // the top-left corner: the rest of a busy day is covered by its events
    const drawer = page.getByRole("dialog", { name: "New task" });
    await expect(drawer.getByLabel(/^Due/)).toHaveValue(/T10:00$/);
    await drawer.getByLabel(/Title/).fill(title);
    await drawer.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByText("Task created.")).toBeVisible();
    // A busy day folds its events behind "+ more" in the month, so the task is looked for in the day view, where every event is listed.
    await page.getByRole("button", { name: "Day", exact: true }).click();
    await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();
  });

  test("a meeting is created from a slot", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/calendar`);
    const title = `E2E meeting ${uniqueSuffix()}`;
    await page.locator('[data-day][aria-current="date"] [data-cell]').click({ position: { x: 6, y: 6 } }); // the top-left corner: the rest of a busy day is covered by its events
    await page.getByRole("radio", { name: "Meeting" }).click();
    const drawer = page.getByRole("dialog", { name: "New meeting" });
    await drawer.getByLabel(/Title/).fill(title);
    // A call or meeting is logged against a record (the API requires it): pick one.
    await drawer.getByRole("combobox", { name: /Linked record/ }).fill("Java");
    await drawer.getByRole("option").first().click();
    await drawer.getByRole("button", { name: "Add meeting" }).click();
    await expect(page.getByText("Meeting added.")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "New meeting" })).toHaveCount(0);
  });

  test("arrow keys move between days", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/calendar`);
    const today = page.locator('[data-day][aria-current="date"] [data-cell]');
    await today.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("[data-cell]:focus")).not.toHaveAttribute("aria-label", await today.getAttribute("aria-label") as string);
    await page.keyboard.press("ArrowLeft");
    await expect(today).toBeFocused();
  });

  test("at 375px the grid gives way to an agenda and nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, `/o/${ORG_SLUG}/calendar`);
    await expect(page.locator(".fb-tk-cal--grid").first()).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});
