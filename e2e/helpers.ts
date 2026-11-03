import type { BrowserContext, Page } from "@playwright/test";

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

/**
 * Safari (WebKit) refuses a `Secure` cookie from plain `http://localhost`; Chrome and Firefox make an exception for localhost. The production
 * build marks the session cookie `Secure` (correct: production is HTTPS), so on the local test server WebKit never keeps its session. For WebKit
 * only, the `Secure` attribute is dropped from the sign-in response in the test browser; the app's own cookie code is not touched (Q1.04).
 */
async function allowSecureCookieOverHttp(page: Page): Promise<void> {
  if (page.context().browser()?.browserType().name() !== "webkit") return;
  await page.route("**/api/auth/login", async (route) => {
    const response = await route.fetch();
    const origin = new URL(route.request().url()).origin;
    const cookies: Array<Parameters<BrowserContext["addCookies"]>[0][number]> = [];
    for (const h of await response.headersArray()) {
      if (h.name.toLowerCase() !== "set-cookie") continue;
      const [pair, ...attrs] = h.value.split(";").map((x) => x.trim());
      const eq = pair.indexOf("=");
      const attr = (k: string) => attrs.find((x) => x.toLowerCase().startsWith(`${k}=`))?.slice(k.length + 1);
      const sameSite = (attr("samesite") ?? "Lax").toLowerCase();
      const maxAge = Number(attr("max-age"));
      cookies.push({
        name: pair.slice(0, eq),
        value: pair.slice(eq + 1),
        url: origin,
        httpOnly: attrs.some((x) => x.toLowerCase() === "httponly"),
        sameSite: sameSite === "strict" ? "Strict" : sameSite === "none" ? "None" : "Lax",
        ...(Number.isFinite(maxAge) && maxAge > 0 ? { expires: Math.floor(Date.now() / 1000) + maxAge } : {}),
      });
    }
    // The browser would drop these (Secure, from plain http); the test puts them in its own jar without the flag, then lets the page see the body.
    await page.context().addCookies(cookies);
    const headers = { ...response.headers() };
    delete headers["set-cookie"];
    await route.fulfill({ response, headers });
  });
}

export async function loginAs(page: Page, email: string): Promise<void> {
  const webkit = page.context().browser()?.browserType().name() === "webkit";
  await allowSecureCookieOverHttp(page);
  await page.goto("/login");
  // WebKit is quicker to show the form than to hydrate it, and a click before hydration is lost.
  if (webkit) await page.waitForLoadState("networkidle");
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
