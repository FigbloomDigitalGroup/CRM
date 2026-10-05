import type { Page } from "@playwright/test";

export const ORG_SLUG = "figbloom";

/**
 * Every seeded dev user shares one password (`DEV_FIXTURE_PASSWORD` in
 * `src/auth/devAccounts.ts`) specifically so it can be used through the
 * real `/login` flow, not just `/dev-login` -- which is hard-disabled
 * whenever `NODE_ENV === "production"` (see `IMPLEMENTATION_NOTES.md`,
 * "Real authentication (FIG-592)"), the mode these e2e specs run the app
 * in (a real `next build`/`next start`, not `next dev`). Real login is
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
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(new RegExp(`/o/${ORG_SLUG}`));
}

/** A short, collision-resistant suffix for test data created during a run -- this DB is shared/persistent locally, fresh-per-run only in CI. */
export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}
