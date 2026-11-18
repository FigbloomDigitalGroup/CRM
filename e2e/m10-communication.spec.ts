import { expect, test, type Page } from "@playwright/test";
import { apiPost, loginAs, ORG_SLUG, uniqueSuffix } from "./helpers";

/**
 * M10, F6.20 to F6.23 (FIG-1378 to FIG-1381): the Communication dropdown, Chat, Mail and Video Conference on demo data. Needs the demo-screens
 * server (see m10-orgside.spec.ts); otherwise skipped, not failed. The dropdown and the move of Conversations are also checked on the
 * normal server in ui-shell.spec.ts.
 */
// Q2.01, Q2.05 (FIG-1179, FIG-1386): on the real API since M14, so it runs on the standard e2e server (ACTIVE_RELEASE=v2). Sending mail and creating a
// meeting need a connected Google or Microsoft account, which a test cannot complete; those paths are covered by tests/mailSync.test.ts, tests/meetings.test.ts
// and tests/q205*.test.ts. Here the not-connected state is the journey.

/** Signs in through the real /login. The dev sign-in chips are not built into the e2e server (only `npm run preview` has them), so clicking one would wait forever. */
async function signInAs(page: Page, email: string) {
  await loginAs(page, email);
}

const orgPath = (page: Page, path: string) => page.url().replace(/\/o\/([^/]+).*/, `/o/$1${path}`);

test.describe("Communication dropdown (F6.20)", () => {
  test("holds Conversations, Mail, Chat and Video Conference, and Conversations is not under Customers", async ({ page }) => {
    await signInAs(page, "dev.management@figbloom.local");
    const sidebar = page.getByRole("complementary", { name: "Sidebar" });
    const group = sidebar.getByRole("button", { name: /Communication/ });
    await expect(group).toHaveAttribute("aria-expanded", "false");
    await group.click();
    for (const name of ["Conversations", "Mail", "Chat", "Video Conference"]) await expect(sidebar.getByRole("link", { name })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Conversations" })).toHaveCount(1);
    await sidebar.getByRole("link", { name: "Conversations" }).click();
    await expect(page).toHaveURL(/\/conversations$/);
    await expect(sidebar.getByRole("button", { name: /Communication/ })).toHaveAttribute("aria-expanded", "true");
  });

  test("Finance sees Chat only and gets the explained no-access on Mail", async ({ page }) => {
    await signInAs(page, "dev.finance@figbloom.local");
    const sidebar = page.getByRole("complementary", { name: "Sidebar" });
    await sidebar.getByRole("button", { name: /Communication/ }).click();
    await expect(sidebar.getByRole("link", { name: "Chat" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Mail" })).toHaveCount(0);
    await page.goto(orgPath(page, "/mail"));
    await expect(page.getByRole("heading", { name: "Mail", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: /Compose/ })).toHaveCount(0);
  });
});

/** Opens a channel by name and waits until it is the open one (a click before the page has hydrated is lost, so it is retried). */
async function openChannel(page: Page, name: RegExp) {
  const channel = page.getByRole("button", { name });
  await expect(async () => {
    await channel.first().click();
    await expect(channel.first()).toHaveAttribute("aria-current", "true", { timeout: 1000 });
  }).toPass();
}

test.describe("Chat (F6.21)", () => {
  test("posts a message, and a payment on a shared deal is masked for Sales but shown to Finance", async ({ page }) => {
    // The chat reads the real API: a deal, its invoice and the shared card are made through it. The amounts are distinct so each can be told apart on the page.
    const suffix = uniqueSuffix();
    const company = `E2E Chat Co ${suffix}`;
    const amount = 137_000;
    // Chat keeps its messages, so the greeting is unique per run.
    const greeting = `Morning everyone ${suffix}`;
    await signInAs(page, "dev.sales@figbloom.local");
    const { company: made } = await (await apiPost(page, `/api/orgs/${ORG_SLUG}/companies`, { name: company, email: `e2e-${suffix}@example.com` })).json();
    const ref = await (await page.request.get(`/api/orgs/${ORG_SLUG}/reference-data`)).json();
    const stage = (key: string) => ref.pipelineStages.find((x: { key: string }) => x.key === key).id as string;
    const deal = await (await apiPost(page, `/api/orgs/${ORG_SLUG}/deals`, { companyId: made.id, pipelineStageId: stage("NEGOTIATION"), value: 120_000, currency: "KES" })).json();
    const origin = new URL(page.url()).origin;
    const won = await page.request.patch(`/api/orgs/${ORG_SLUG}/deals/${deal.id}`, { data: { pipelineStageId: stage("CLOSED_WON"), handoff: { ownerLater: true } }, headers: { origin } });
    expect(won.ok(), await won.text()).toBe(true);

    // Finance raises the invoice that makes a payment due on it.
    await page.context().clearCookies();
    await signInAs(page, "dev.finance@figbloom.local");
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const invoice = await apiPost(page, `/api/orgs/${ORG_SLUG}/invoices`, { number: `E2E-${suffix}`.toUpperCase(), amount, issuedOn: day(-40), dueOn: day(10), dealId: deal.id, sent: true });
    expect(invoice.ok(), await invoice.text()).toBe(true);

    // Sales posts in #general, then shares the deal as a card there.
    await page.context().clearCookies();
    await signInAs(page, "dev.sales@figbloom.local");
    await page.goto(orgPath(page, "/chat"));
    await openChannel(page, /^general/);
    await page.getByRole("textbox", { name: "Message #general" }).fill(greeting);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("log", { name: "Messages" }).getByText(greeting)).toBeVisible();
    const channels = await (await page.request.get(`/api/orgs/${ORG_SLUG}/chat/channels`)).json();
    const general = (channels.items ?? channels).find((c: { name: string | null }) => c.name === "general");
    const shared = await apiPost(page, `/api/orgs/${ORG_SLUG}/chat/channels/${general.id}/messages`, { body: `Deal for ${company}`, card: { type: "DEAL", id: deal.id } });
    expect(shared.ok(), await shared.text()).toBe(true);

    await page.goto(orgPath(page, "/chat"));
    await openChannel(page, /^general/);
    // #general keeps the cards earlier runs shared, so look only at this run's card: the nearest block around its company link that has a "Payment due" row.
    const card = () => page.getByRole("link", { name: company }).locator("xpath=ancestor::*[.//dt[normalize-space()='Payment due']][1]");
    await expect(card()).toContainText("Payment due");
    await expect(card()).not.toContainText(/137,000/);

    await page.context().clearCookies();
    await signInAs(page, "dev.finance@figbloom.local");
    await page.goto(orgPath(page, "/chat"));
    await openChannel(page, /^general/);
    await expect(card()).toContainText(/137,000/);
  });

  test("Restricted Technical sees only the channels it was added to", async ({ page }) => {
    await signInAs(page, "dev.tech@figbloom.local");
    await page.goto(orgPath(page, "/chat"));
    await expect(page.getByRole("button", { name: /field-ops/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /sales-team/ })).toHaveCount(0);
  });

  test("375px: one pane at a time, with a way back to the list", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signInAs(page, "dev.management@figbloom.local");
    await page.goto(orgPath(page, "/chat"));
    await expect(page.getByRole("textbox", { name: /Message/ })).toBeHidden();
    await expect(async () => {
      await page.getByRole("button", { name: /general/ }).click();
      await expect(page.getByRole("textbox", { name: "Message #general" })).toBeVisible({ timeout: 1000 });
    }).toPass();
    await expect(async () => {
      await page.getByRole("button", { name: "Back to channels" }).click();
      await expect(page.getByRole("textbox", { name: /Message/ })).toBeHidden({ timeout: 1000 });
    }).toPass();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe("Mail (F6.22) and Video Conference (F6.23)", () => {
  test("with no mailbox connected, Mail says so, Compose is disabled, and Connect explains the provider sign-in", async ({ page }) => {
    await signInAs(page, "dev.management@figbloom.local");
    await page.goto(orgPath(page, "/mail"));
    await expect(page.getByText("Your mailbox is not connected.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Compose/ })).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("button", { name: "Connect mailbox" }).click();
    await expect(page.getByRole("dialog").getByText(/You will sign in with your provider/)).toBeVisible();
    await page.keyboard.press("Escape"); // leaving for Google or Microsoft cannot be completed in a test
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("with no calendar connected, Video Conference says so and Schedule is disabled", async ({ page }) => {
    await signInAs(page, "dev.sales@figbloom.local");
    await page.goto(orgPath(page, "/video"));
    await expect(page.getByText("Your calendar is not connected.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Schedule/ }).first()).toHaveAttribute("aria-disabled", "true");
    await page.getByRole("button", { name: "Connect calendar" }).click();
    await expect(page.getByRole("dialog").getByText(/You will sign in with your provider/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
