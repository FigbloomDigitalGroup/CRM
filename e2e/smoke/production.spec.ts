import { expect, test, type Page } from "@playwright/test";

/**
 * FIG-1131 (P1.09): production smoke suite, one run per role, read-only.
 *
 * Rules: sign in through the real login form only (no dev chips, no dev routes: they are closed in production); open screens and read; never
 * create, edit or delete. Every request this suite makes is a GET, apart from the sign-in and sign-out the page itself performs.
 *
 * Environment (a role without both variables is skipped with a message, not failed):
 *   SMOKE_BASE_URL          the production address, for example https://crm.example.com
 *   SMOKE_ORG_SLUG          the organisation slug (default "figbloom")
 *   SMOKE_<ROLE>_EMAIL and SMOKE_<ROLE>_PASSWORD   ROLE is MANAGEMENT, SALES, DELIVERY, FINANCE, TECHNICAL or SUPPORT
 * Use dedicated smoke accounts; never put a password in a file or a commit.
 *
 * Run: npx playwright test -c e2e/smoke/playwright.smoke.config.ts --grep @smoke
 */

const BASE = process.env.SMOKE_BASE_URL;
const ORG = process.env.SMOKE_ORG_SLUG || "figbloom";
const NO_ACCESS = /isn.t part of your workspace|aren.t available for your role|can.t see|not available|don.t have access|no access/i;

interface Role {
  key: string;
  env: string;
  label: string;
  /** Screens (under /o/{org}) the role must be able to open. */
  screens: string[];
  /** Screens the role must be refused with the explained no-access. */
  refused: string[];
  /** Organisation API paths that must not answer 2xx for the role (payments). */
  deniedApi: string[];
}

const PAYMENTS = ["payments"];
const ROLES: Role[] = [
  { key: "management", env: "MANAGEMENT", label: "Management", screens: ["", "/leads", "/deals", "/tasks", "/companies", "/payments", "/reports", "/settings"], refused: [], deniedApi: [] },
  { key: "sales", env: "SALES", label: "Sales", screens: ["", "/leads", "/deals", "/tasks", "/companies", "/reports"], refused: ["/payments", "/settings"], deniedApi: PAYMENTS },
  { key: "delivery", env: "DELIVERY", label: "Delivery", screens: ["", "/deals", "/handoffs", "/tasks", "/companies"], refused: ["/payments", "/settings"], deniedApi: PAYMENTS },
  { key: "finance", env: "FINANCE", label: "Finance", screens: ["", "/deals", "/payments", "/reports", "/companies"], refused: ["/settings"], deniedApi: [] },
  { key: "technical", env: "TECHNICAL", label: "Restricted Technical", screens: ["", "/tasks"], refused: ["/deals", "/payments", "/reports", "/settings"], deniedApi: PAYMENTS },
  { key: "support", env: "SUPPORT", label: "Customer Support", screens: ["", "/tasks", "/companies", "/contacts", "/conversations"], refused: ["/payments", "/settings"], deniedApi: PAYMENTS },
];

/** Collects uncaught page errors and 5xx answers; the test asserts the list is empty. */
function watch(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`page error at ${new URL(page.url()).pathname}: ${e.message.slice(0, 120)}`));
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  return problems;
}

async function realLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  // PasswordInput nests a "Show password" button in the label, so select the field by type.
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(new RegExp(`/o/${ORG}`), { timeout: 30_000 });
}

async function opens(page: Page, path: string): Promise<"page" | "no-access"> {
  const response = await page.goto(`/o/${ORG}${path}`);
  expect(response?.status(), `${path || "home"} status`).toBeLessThan(500);
  const h1 = page.getByRole("heading", { level: 1 }).first();
  const refusal = page.getByText(NO_ACCESS).first();
  await expect(h1.or(refusal).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  return (await refusal.isVisible()) ? "no-access" : "page";
}

test.describe("@smoke production smoke", () => {
  test.skip(!BASE, "SMOKE_BASE_URL is not set: the production smoke suite needs the address of the deployed app.");

  test("@smoke dev sign-in is closed in production", async ({ request }) => {
    // The dev routes must answer closed, never a session. A GET is enough and changes nothing.
    for (const path of ["/api/dev-session", "/api/dev-sentry-test"]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect([301, 302, 307, 308, 401, 403, 404, 405], `${path} must be closed`).toContain(res.status());
    }
    const login = await request.get("/login");
    expect(login.status()).toBeLessThan(500);
    expect(await login.text()).not.toMatch(/dev\.[a-z]+@figbloom\.local/i);
  });

  for (const role of ROLES) {
    test.describe(`@smoke ${role.label}`, () => {
      const email = process.env[`SMOKE_${role.env}_EMAIL`];
      const password = process.env[`SMOKE_${role.env}_PASSWORD`];
      test.skip(!email || !password, `SMOKE_${role.env}_EMAIL and SMOKE_${role.env}_PASSWORD are not set: ${role.label} is not smoke-tested.`);

      test(`@smoke ${role.label}: sign in, home, main screens, masking, sign out`, async ({ page }) => {
        test.setTimeout(180_000);
        const problems = watch(page);

        await realLogin(page, email!, password!);

        // Lands on the role's home: an organisation page with a heading and no error state.
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText(/something went wrong/i)).toHaveCount(0);

        for (const path of role.screens) {
          expect(await opens(page, path), `${role.label} must open ${path || "home"}`).toBe("page");
        }
        for (const path of role.refused) {
          expect(await opens(page, path), `${role.label} must be refused ${path}`).toBe("no-access");
        }

        // Masking, read through the API the pages use (GET only).
        for (const api of role.deniedApi) {
          const res = await page.request.get(`/api/orgs/${ORG}/${api}?limit=1`);
          expect(res.ok(), `${role.label} must not read /${api}`).toBe(false);
          expect(res.status()).toBeLessThan(500);
        }
        if (role.key === "sales") {
          await page.goto(`/o/${ORG}`);
          await expect(page.getByRole("link", { name: /^payments$/i })).toHaveCount(0);
        }
        if (role.key === "technical") {
          // Never a deal value or a finance figure on the home, nor in its API.
          await page.goto(`/o/${ORG}`);
          await page.waitForLoadState("networkidle");
          for (const text of [/KES\s?\d/, /Pipeline by stage/, /invoice/i, /margin/i]) {
            await expect(page.getByText(text)).toHaveCount(0);
          }
          const dash = await page.request.get(`/api/orgs/${ORG}/dashboard`);
          expect(dash.status()).toBeLessThan(500);
          if (dash.ok()) expect(JSON.stringify(await dash.json())).not.toMatch(/"value"|openValue|payments/);
        }

        // Sign out returns to the login page and closes the session.
        await page.goto(`/o/${ORG}`);
        await page.getByRole("button", { name: "Log out" }).first().click();
        await page.waitForURL(/\/login/, { timeout: 20_000 });
        const after = await page.request.get(`/api/orgs/${ORG}/dashboard`);
        expect([401, 403]).toContain(after.status());

        expect(problems, "no 5xx answers and no uncaught page errors").toEqual([]);
      });
    });
  }
});
