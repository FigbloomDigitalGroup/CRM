import { expect, test } from "@playwright/test";
import { apiPost, loginAs, ORG_SLUG, uniqueSuffix } from "./helpers";

/**
 * F4.12 offline mode: a lead captured with no signal is kept on the phone, shown as waiting, and sent once when the connection returns. Also
 * the sync idempotency check against the real API: the same batch sent twice applies once and answers DUPLICATE the second time.
 */
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

const M = `/o/${ORG_SLUG}/m`;

test("a capture made offline waits on the phone and syncs once when back online", async ({ page, context }) => {
  await loginAs(page, "dev.sales@figbloom.local");
  await page.waitForURL(new RegExp(`${M}$`));
  await page.waitForLoadState("networkidle");

  const suffix = uniqueSuffix();
  const name = `Offline Capture ${suffix}`;
  await context.setOffline(true);
  await expect(page.getByRole("status").filter({ hasText: /Offline · 0 changes waiting to sync/ })).toBeVisible();

  await page.getByRole("button", { name: "Quick capture" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Quick capture" });
  await sheet.getByLabel("Company or person *").fill(name);
  await sheet.getByLabel("Phone *").fill(`+2547${String(Date.now()).slice(-8)}`);
  await sheet.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByText("Saved on this phone. It sends when you are back online.")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /Offline · 1 change waiting to sync/ })).toBeVisible();

  // The waiting list says what is held and that it has not gone anywhere.
  await page.getByRole("button", { name: "Details" }).click();
  const queue = page.getByRole("dialog", { name: "Waiting to sync" });
  await expect(queue.getByText(`New lead: ${name}`)).toBeVisible();
  await expect(queue.getByText("Waiting for a connection")).toBeVisible();
  await page.keyboard.press("Escape");

  await context.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: /Offline/ })).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(async () => page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k.startsWith("figbloom-offline-queue:"))?.[1] ?? "[]").length), { timeout: 20_000 }).toBe(0);

  // It arrived once.
  await page.goto(`${M}/leads`);
  await page.getByPlaceholder("Search my leads").fill(suffix); // the list search matches a first or a last name, not a whole full name
  await expect(page.getByRole("link").filter({ hasText: name })).toHaveCount(1);
});

test("the same sync batch sent twice applies once (idempotent), and a stage change is never applied", async ({ page }) => {
  await loginAs(page, "dev.sales@figbloom.local");
  await page.waitForLoadState("networkidle");
  const clientId = `e2e-${uniqueSuffix()}-note`;
  const lead = await page.request.get(`/api/orgs/${ORG_SLUG}/leads?pageSize=1`);
  const leadId = (await lead.json()).items[0].id as string;
  const body = { mutations: [{ clientId, kind: "NOTE_ADD", payload: { leadId, text: "Sync idempotency check" }, clientCreatedAt: new Date().toISOString() }] };
  const first = await (await apiPost(page, `/api/orgs/${ORG_SLUG}/sync/batch`, body)).json();
  expect(first.results[0].status).toBe("APPLIED");
  const second = await (await apiPost(page, `/api/orgs/${ORG_SLUG}/sync/batch`, body)).json();
  expect(second.results[0].status).toBe("DUPLICATE");

  const stage = await (await apiPost(page, `/api/orgs/${ORG_SLUG}/sync/batch`, { mutations: [{ clientId: `e2e-${uniqueSuffix()}-stage`, kind: "STAGE_CHANGE", payload: { dealId: "x", stageId: "y" } }] })).json();
  expect(["REJECTED", "CONFLICT"]).toContain(stage.results[0].status);
});
