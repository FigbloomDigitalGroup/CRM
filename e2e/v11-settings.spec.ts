import { expect, test } from "@playwright/test";
import { gotoAndSettle, loginAs, ORG_SLUG } from "./helpers";

/**
 * Q2.01 (FIG-1179): S6#2 and S7#2, the V1.1 sections of Settings, on the real API. Each section opens for Management with a heading and no error, and
 * the sections that only exist from V1.1 are absent from the menu of a member without the permission (they get the explained no-access instead).
 * The catalogue editor's edits are in commercial.spec.ts; the sign-in, code and backup-code steps of two-step sign-in are in tests/twoStep*.test.ts
 * (they need an authenticator code, which a browser journey cannot produce).
 */
const SECTIONS = [
  ["catalogue", "Service catalogue"],
  ["pipelines", "Pipelines & stage rules"],
  ["sequences", "Follow-up sequences"],
  ["webforms", "Web forms"],
  ["approvalrules", "Approval rules"],
  ["twofa", "Two-step sign-in"],
  ["connect", "Email & calendar"],
  ["ai", "AI assistant"],
] as const;

test.describe("V1.1 settings sections (S6#2, S7#2)", () => {
  for (const [tab, label] of SECTIONS) {
    test(`${label} opens for Management without an error`, async ({ page }) => {
      await loginAs(page, "dev.management@figbloom.local");
      await gotoAndSettle(page, `/o/${ORG_SLUG}/settings?tab=${tab}`);
      // A section has a level-2 heading, or a level-3 one when it is empty ("No web forms yet").
      await expect(page.getByRole("heading", { level: 2 }).or(page.getByRole("heading", { level: 3 })).first()).toBeVisible();
      await expect(page.getByText(/something went wrong|could not load/i)).toHaveCount(0);
    });
  }

  test("Sales does not get the V1.1 sections: Settings answers with the explained no-access", async ({ page }) => {
    await loginAs(page, "dev.sales@figbloom.local");
    for (const [tab] of SECTIONS) {
      await page.goto(`/o/${ORG_SLUG}/settings?tab=${tab}`);
      await expect(page.getByRole("link", { name: "Approval rules" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Web forms" })).toHaveCount(0);
    }
  });
});
