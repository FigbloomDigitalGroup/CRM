import type { Page } from "@playwright/test";

export const ORG_SLUG = "figbloom";

/**
 * Every seeded dev user shares one password (`DEV_FIXTURE_PASSWORD` in
 * `src/auth/devAccounts.ts`) specifically so it can be used through the
 * real `/login` flow, not just the dev sign-in chips -- which only work when
 * `NODE_ENV` is explicitly `"development"` (FIG-605; see
 * `IMPLEMENTATION_NOTES.md`, "Real authentication (FIG-592)"), and these
 * e2e specs run the app as a real `next build`/`next start` (not
 * `next dev`), so it's unavailable here regardless. Real login is
 * also one of this ticket's own required flows, so every spec uses it,
 * not a shortcut around it.
 */
export const DEV_PASSWORD = "figbloom-dev-local";

export async function loginAs(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  // Not getByLabel("Password"): PasswordInput nests a "Show password"
  // toggle button inside the same <label>, which the browser folds into
  // the input's own computed accessible name ("Password Show password"),
  // and getByLabel's default case-insensitive substring match then also
  // matches the toggle button itself (its own name, "Show password",
  // contains "password"). A plain CSS type selector sidesteps all of that.
  await page.locator('input[type="password"]').fill(DEV_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(new RegExp(`/o/${ORG_SLUG}`));
}

/** A short, collision-resistant suffix for test data created during a run -- this DB is shared/persistent locally, fresh-per-run only in CI. */
export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/** Goes to a page and waits until React has hydrated, so a fill/click is not lost to a not-yet-interactive client component. */
export async function gotoAndSettle(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/**
 * Calls the app's own API the way its pages do. Same-origin requests carry an
 * `Origin` header from a real browser; Playwright's request client does not
 * add one, and the API refuses state-changing requests without it (FIG-802).
 */
export async function apiPost(page: Page, path: string, data?: unknown) {
  const origin = new URL(page.url() === "about:blank" ? "http://localhost:3100" : page.url()).origin;
  return page.request.post(path, { data, headers: { origin } });
}
