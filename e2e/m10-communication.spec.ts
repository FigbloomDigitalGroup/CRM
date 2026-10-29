import { expect, test, type Page } from "@playwright/test";

/**
 * M10, F6.20 to F6.23 (FIG-1378 to FIG-1381): the Communication dropdown, Chat, Mail and Video Conference on demo data. Needs the demo-screens
 * server (see m10-support-orgside.spec.ts); otherwise skipped, not failed. The dropdown and the move of Conversations are also checked on the
 * normal server in ui-shell.spec.ts.
 */
const demoServer = process.env.E2E_DEMO_SCREENS === "true";
test.beforeEach(() => {
  test.skip(!demoServer, "needs a demo-screens server (DEMO_SCREENS, NEXT_PUBLIC_DEMO_SCREENS, ACTIVE_RELEASE=v2)");
});

async function signInAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(email.split("@")[0]!.replace("dev.", ""), "i") }).first().click();
  await page.waitForURL(/\/o\//);
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

test.describe("Chat (F6.21)", () => {
  test("posts a message, and a payment on a shared deal is masked for Sales but shown to Finance", async ({ page }) => {
    await signInAs(page, "dev.sales@figbloom.local");
    await page.goto(orgPath(page, "/chat"));
    await page.getByRole("textbox", { name: "Message #general" }).fill("Morning everyone");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("log", { name: "Messages" }).getByText("Morning everyone")).toBeVisible();
    await page.getByRole("button", { name: /Kisumu Greens website/ }).click();
    await expect(page.getByText("Payment due")).toBeVisible();
    await expect(page.getByText(/120,000/)).toHaveCount(0);

    await page.context().clearCookies();
    await signInAs(page, "dev.finance@figbloom.local");
    await page.goto(orgPath(page, "/chat"));
    await page.getByRole("button", { name: /Kisumu Greens website/ }).click();
    await expect(page.getByText(/120,000/)).toBeVisible();
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
    await page.getByRole("button", { name: /general/ }).click();
    await expect(page.getByRole("textbox", { name: "Message #general" })).toBeVisible();
    await page.getByRole("button", { name: "Back to channels" }).click();
    await expect(page.getByRole("textbox", { name: /Message/ })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe("Mail (F6.22) and Video Conference (F6.23)", () => {
  test("connect, send a logged mail, link an unlinked message", async ({ page }) => {
    await signInAs(page, "dev.management@figbloom.local");
    await page.goto(orgPath(page, "/mail"));
    await page.getByRole("button", { name: "Connect mailbox" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Connect" }).click();
    await page.getByRole("button", { name: /Compose/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/^To/).fill("esther@savannafoods.example");
    await dialog.getByLabel(/Subject/).fill("Quote follow-up");
    await dialog.getByLabel(/Message/).fill("Thanks for your time.");
    await dialog.getByLabel(/Record/).selectOption("deal:savanna");
    await dialog.getByRole("button", { name: /Send/ }).click();
    await expect(page.getByText(/Sent and logged on Deal: Savanna Foods/)).toBeVisible();
    await page.getByRole("tab", { name: /Needs linking/ }).click();
    await page.getByRole("button", { name: /Do you do POS for dairies/ }).click();
    await page.getByLabel("Link to a record").selectOption("lead:nakuru");
    await page.getByRole("button", { name: "Link", exact: true }).click();
    await expect(page.getByText("Nothing needs linking")).toBeVisible();
  });

  test("schedule a meeting with a link, and a contact with no email is flagged", async ({ page }) => {
    await signInAs(page, "dev.sales@figbloom.local");
    await page.goto(orgPath(page, "/video"));
    await page.getByRole("button", { name: "Connect calendar" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Connect" }).click();
    await page.getByRole("button", { name: /Schedule/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Title/).fill("Kisumu review");
    await dialog.getByLabel(/Lucy Chebet/).check();
    await expect(dialog.getByText(/will not get an invite/)).toBeVisible();
    await dialog.getByLabel(/Amina Wekesa/).check();
    await dialog.getByRole("button", { name: /Schedule and send invites/ }).click();
    await expect(page.getByText("Kisumu review")).toBeVisible();
  });
});
