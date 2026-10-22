import { expect, test } from "@playwright/test";
import { apiPost, gotoAndSettle, loginAs } from "./helpers";

/**
 * FIG-802 against the real running server (tests/csrf.test.ts covers the rule
 * itself): a signed-in session cannot be driven from another origin.
 */
test("a cross-origin POST with a valid session is refused with 403", async ({ page }) => {
  await loginAs(page, "dev.management@figbloom.local");
  await gotoAndSettle(page, "/o/figbloom/contacts");

  const evil = await page.request.post("/api/orgs/figbloom/contacts", {
    data: { firstName: "Forged" },
    headers: { origin: "https://evil.example" },
  });
  expect(evil.status()).toBe(403);
  expect((await evil.json()).code).toBe("CSRF_REJECTED");

  const noOrigin = await page.request.post("/api/orgs/figbloom/contacts", {
    data: { firstName: "Forged" },
  });
  expect(noOrigin.status()).toBe(403);

  // Same session, same request, own origin: accepted.
  const own = await apiPost(page, "/api/orgs/figbloom/contacts", { firstName: "CsrfOwnOrigin" });
  expect(own.ok()).toBe(true);
});

test("cross-origin GETs are not blocked by the check", async ({ page }) => {
  await loginAs(page, "dev.management@figbloom.local");
  const res = await page.request.get("/api/orgs/figbloom/contacts", {
    headers: { origin: "https://evil.example" },
  });
  expect(res.ok()).toBe(true);
});
