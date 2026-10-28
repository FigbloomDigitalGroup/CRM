import { expect, test } from "@playwright/test";
import { loginAs, ORG_SLUG, uniqueSuffix } from "./helpers";

/**
 * "Website capture to lead" (FIG-602 AC) has no literal web page to click
 * through here -- the public endpoint exists specifically to be called by
 * an *external* website's own backend (see README.md, "Website lead
 * capture"), not anything this app renders. This spec drives the real
 * boundary instead: generate a real website API key through the actual
 * Settings UI, POST to the real public endpoint with it (Playwright's
 * `request` context, a real HTTP call, not a mock), then confirm the
 * resulting Lead actually shows up through the real Leads UI.
 */
test("a public website submission becomes a visible lead", async ({ page, request }) => {
  const suffix = uniqueSuffix();
  // No spaces: the lead list shows/searches the contact's *first* name
  // only (`splitName` in `src/repositories/leadIngestion.ts` splits on the
  // first space), so a multi-word name here wouldn't match in either
  // place -- a single "word" keeps the submitted name, the search query,
  // and the rendered link text all identical.
  const enquirerName = `E2EWebsiteLead${suffix}`;

  await loginAs(page, "dev.management@figbloom.local");

  let apiKey = "";
  await test.step("generate a website API key from Settings", async () => {
    await page.goto(`/o/${ORG_SLUG}/settings?tab=website`);
    // M9 (F4.04): a configured key is rotated (a confirmation dialog first), a missing one is created; either way the new key is shown once.
    const create = page.getByRole("button", { name: "Create key" });
    const rotate = page.getByRole("button", { name: "Rotate" });
    await expect(create.or(rotate)).toBeVisible();
    const responseFor = () =>
      page.waitForResponse(
        (r) =>
          r.url().includes(`/api/orgs/${ORG_SLUG}/integrations/website-key`) &&
          r.request().method() === "POST",
      );
    const pending = responseFor();
    if (await create.isVisible()) {
      await create.click();
    } else {
      await rotate.click();
      await page.getByRole("dialog", { name: "Rotate the website key?" }).getByRole("button", { name: "Create new key" }).click();
    }
    const response = await pending;
    expect(response.ok()).toBe(true);
    const body = await response.json();
    apiKey = body.apiKey;
    expect(apiKey).toBeTruthy();
    await expect(page.getByTestId("new-website-key")).toHaveText(apiKey);
  });

  await test.step("submit a public website lead using the generated key", async () => {
    const res = await request.post(`/api/public/orgs/${ORG_SLUG}/leads`, {
      headers: { "x-figbloom-api-key": apiKey },
      data: {
        name: enquirerName,
        email: `e2e.${suffix}@example.test`,
        message: "e2e website capture test",
      },
    });
    expect(res.ok()).toBe(true);
  });

  await test.step("the new lead is visible in the Leads UI", async () => {
    await page.goto(`/o/${ORG_SLUG}/leads?q=${encodeURIComponent(enquirerName)}`);
    await expect(page.getByRole("link", { name: enquirerName })).toBeVisible();
  });
});
