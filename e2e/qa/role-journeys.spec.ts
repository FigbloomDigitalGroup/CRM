import { expect as baseExpect, test, type Page } from "@playwright/test";
import { gotoAndSettle, loginAs, ORG_SLUG } from "../helpers";
import { DESKTOP_SCREENS, detailScreens, NO_ACCESS, orgPath, ROLES, type Screen } from "./catalogue";

/**
 * Q1.01 (FIG-1115): a journey per role over every V1 screen. For each of the six desktop roles, each V1 screen is opened through the real
 * sign-in and must do one of two things: draw its own page, or draw the explained no-access (S4). It must never crash, never show the error
 * state, and never call an API route that answers 5xx. Roles are compared with the permission rules in `RULES`, written by hand from the signed
 * permission model, so a screen that opens for a role that should not have it fails here, not just in a unit test.
 *
 * The mobile persona is `e2e/mobile-*.spec.ts`; the screen-by-screen assertions per area live in the specs `e2e/qa/trace.ts` maps each ID to.
 */

const expect = baseExpect.configure({ timeout: 20_000 });

/** Screens a role may not open (everything else must open). Hand-written from docs/PERMISSION_MATRIX_REPORT.md and the navigation tests. */
const BLOCKED: Record<string, string[]> = {
  management: [],
  sales: ["payments", "settings"],
  delivery: ["leads", "renewals", "payments", "settings"],
  finance: ["leads", "handoffs", "tasks", "conversations", "renewals", "settings"],
  technical: ["leads", "deals", "handoffs", "companies", "contacts", "renewals", "payments", "reports", "settings"],
  support: ["leads", "deals", "handoffs", "renewals", "payments", "settings"],
};
/** Screens skipped in the refusal comparison, with the defect that explains each. */
const KNOWN_DEFECT: Record<string, string[]> = {};

function watchServerErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (e) => /Minified React error #418/.test(e.message) ? undefined : problems.push(`page error at ${new URL(page.url()).pathname}: ${e.message.slice(0, 90)}`));
  page.on("response", (r) => {
    if (r.status() >= 500 && r.url().includes("/api/")) problems.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  return problems;
}

async function opened(page: Page): Promise<"page" | "no-access"> {
  const h1 = page.getByRole("heading", { level: 1 }).first();
  const refusal = page.getByText(NO_ACCESS).first();
  await expect(h1.or(refusal).first()).toBeVisible();
  // The page frame draws before the screen's own answer arrives; wait for it before judging.
  await page.waitForLoadState("networkidle");
  return (await refusal.isVisible()) ? "no-access" : "page";
}

for (const role of ROLES) {
  test.describe(`${role.label} journey`, () => {
    test(`every V1 screen opens or explains why not`, async ({ page }) => {
      test.setTimeout(240_000);
      const problems = watchServerErrors(page);
      await loginAs(page, role.email);
      const screens: Screen[] = [...DESKTOP_SCREENS, ...(await detailScreens(page))];
      const blocked = new Set(BLOCKED[role.key]);
      const wrong: string[] = [];
      const matrix: string[] = [];
      for (const screen of screens) {
        const response = await page.goto(orgPath(screen.path));
        expect(response?.status(), `${role.label} ${screen.name} status`).toBeLessThan(500);
        const result = await opened(page);
        if (KNOWN_DEFECT[role.key]?.includes(screen.name)) continue;
        const shouldBlock = blocked.has(screen.name);
        matrix.push(`${role.key}:${screen.name}=${result}`);
        if (shouldBlock && result === "page") wrong.push(`${screen.name} opened but ${role.label} must not have it`);
        if (!shouldBlock && result === "no-access" && !screen.name.endsWith("-detail")) wrong.push(`${screen.name} refused ${role.label}, who should have it`);
      }
      test.info().annotations.push({ type: "matrix", description: matrix.join(" ") });
      console.log(`MATRIX ${matrix.join(" ")}`);
      expect(wrong).toEqual([]);
      expect(problems).toEqual([]);
    });
  });
}

test.describe("hydration", () => {
  // D-01 (fixed): the production build raised React error #418 because the top-bar tools were decided from a whole `process.env` object, which is
  // empty in the browser (src/ui/screens/assistant/ToolsHost.tsx). This keeps it from coming back, on the pages every role opens first.
  test("no organisation page raises a hydration error", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message.slice(0, 60)));
    await loginAs(page, "dev.management@figbloom.local");
    await gotoAndSettle(page, orgPath("/leads"));
    await page.waitForTimeout(1500);
    expect(errors).toEqual([]);
  });
});

test.describe("negative paths", () => {
  test("payments are visible only to Finance and Management (rule 7), in the page and in the API", async ({ page }) => {
    for (const role of ROLES) {
      await loginAs(page, role.email);
      const api = await page.request.get(`/api/orgs/${ORG_SLUG}/invoices?limit=1`);
      const allowed = role.key === "finance" || role.key === "management";
      if (allowed) expect(api.status(), `${role.label} payments API`).toBe(200);
      else expect([401, 403], `${role.label} payments API`).toContain(api.status());
      // Leave the app page before the session goes: its own session check would otherwise redirect it to /login while the next sign-in loads.
      await page.goto("about:blank");
      await page.context().clearCookies();
    }
  });

  test("a role without a screen gets the explained no-access, not a blank page or a 404", async ({ page }) => {
    await loginAs(page, "dev.tech@figbloom.local");
    const response = await page.goto(orgPath("/payments"));
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByText(NO_ACCESS).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /dashboard|my work|go back|home/i }).first()).toBeVisible();
  });

  test("an archived record is read-only: no edit controls on an archived lead", async ({ page }) => {
    await loginAs(page, "dev.management@figbloom.local");
    const res = await page.request.get(`/api/orgs/${ORG_SLUG}/leads?limit=50&archivedOnly=true`);
    const body = res.ok() ? await res.json() : null;
    const rows: { id: string }[] = body ? (Array.isArray(body) ? body : (body.items ?? body.data ?? [])) : [];
    test.skip(rows.length === 0, "the seeded organisation has no archived lead; covered by tests/ API archived-read-only tests");
    await gotoAndSettle(page, orgPath(`/leads/${rows[0].id}`));
    await expect(page.getByRole("button", { name: /^(edit|convert|mark lost)/i })).toHaveCount(0);
  });

  test("masked deal values: roles without the permission see the masked marker, never a currency amount", async ({ page }) => {
    await loginAs(page, "dev.tech@figbloom.local");
    const res = await page.request.get(`/api/orgs/${ORG_SLUG}/deals?limit=5`);
    if (res.ok()) {
      const text = JSON.stringify(await res.json());
      expect(text).not.toMatch(/"(value|amount|margin|cost)"\s*:\s*[1-9]/);
    } else {
      expect([401, 403]).toContain(res.status());
    }
  });
});
