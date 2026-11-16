import { expect, test } from "@playwright/test";
import { apiPost, gotoAndSettle, loginAs, ORG_SLUG, uniqueSuffix } from "./helpers";

/** FIG-1678 (P2-24): add a key note from the lead preview on the Leads list, then see it in the lead's Conversation. */

test("a note added in the lead preview appears in the lead's Conversation", async ({ page }) => {
  const suffix = uniqueSuffix();
  await loginAs(page, "dev.sales@figbloom.local");
  const ref = await (await page.request.get(`/api/orgs/${ORG_SLUG}/reference-data`)).json();
  const company = await (await apiPost(page, `/api/orgs/${ORG_SLUG}/companies`, { name: `E2E Notes Co ${suffix}` })).json();
  const res = await apiPost(page, `/api/orgs/${ORG_SLUG}/leads`, { leadStatusId: ref.leadStatuses.find((s: { key: string }) => s.key === "NEW").id, companyId: company.company.id });
  expect(res.ok()).toBe(true);
  const leadId = (await res.json()).lead.id as string;

  await gotoAndSettle(page, `/o/${ORG_SLUG}/leads`);
  await page.getByRole("button", { name: `Key notes for E2E Notes Co ${suffix}` }).click();
  const dialog = page.getByRole("dialog", { name: "Key notes" });
  await expect(dialog.getByText("No key notes yet")).toBeVisible();
  const text = `Wants a site visit ${suffix}`;
  await dialog.getByLabel("Add note").fill(text);
  await dialog.getByLabel("Add note").press("Control+Enter");
  await expect(dialog.getByText(text)).toBeVisible();

  await gotoAndSettle(page, `/o/${ORG_SLUG}/leads/${leadId}`);
  await expect(page.getByText(text).first()).toBeVisible();
});
