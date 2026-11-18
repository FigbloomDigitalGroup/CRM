/**
 * Smoke suite for staging (FIG-1123, P1.01): run after every deploy. Needs only HTTP access to the deployed app.
 *
 *   STAGING_URL=https://staging.example tsx scripts/staging-smoke.ts
 *   (add STAGING_UAT_PASSWORD to also run the signed-in role checks)
 *
 * Read-only: it signs in and reads, and creates nothing. Exit code 1 if any check fails.
 */
import "dotenv/config";
import { uatEmail } from "./stagingGuard";

const base = (process.env.STAGING_URL ?? "").replace(/\/$/, "");
const slug = process.env.STAGING_ORG_SLUG ?? "figbloom";
const password = process.env.STAGING_UAT_PASSWORD;

let failed = 0;
function report(ok: boolean, name: string, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function get(path: string, cookie?: string) {
  return fetch(base + path, { redirect: "manual", headers: cookie ? { cookie } : {} });
}

async function signIn(roleKey: string): Promise<string | null> {
  const res = await fetch(base + "/api/auth/login", {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email: uatEmail(roleKey), password }),
  });
  if (res.status !== 200) return null;
  const cookies = res.headers.getSetCookie?.() ?? [];
  return cookies.map((c) => c.split(";")[0]).join("; ") || null;
}

async function main() {
  if (!/^https:\/\//.test(base) && !/^http:\/\/localhost/.test(base)) {
    throw new Error("Set STAGING_URL to the https address of staging.");
  }

  const health = await get("/api/health");
  const body = (await health.json().catch(() => ({}))) as { status?: string };
  report(health.status === 200 && body.status === "ok", "health: app up and database reachable", `HTTP ${health.status}`);

  const login = await get("/login");
  report(login.status === 200, "login page loads", `HTTP ${login.status}`);
  const html = await login.text();
  report(!html.includes("data-figbloom-dev-chips") && !html.includes("Dev sign-in"), "no dev sign-in chips on the login page");

  report((await get("/dev-login")).status !== 200, "dev sign-in page is closed");
  const dev = await fetch(base + "/api/dev-session", { method: "POST", redirect: "manual" });
  report(dev.status >= 400 || dev.status === 307 || dev.status === 308, "dev session route is closed", `HTTP ${dev.status}`);

  report(login.headers.get("x-frame-options") === "DENY", "security headers present (X-Frame-Options)");
  report(/max-age/.test(login.headers.get("strict-transport-security") ?? ""), "HSTS present");
  report((await get("/api/me/context")).status === 401, "API refuses an anonymous caller");
  report(
    (await get(`/api/orgs/${slug}/leads`)).status === 401,
    "organisation data refuses an anonymous caller",
  );

  if (!password) {
    console.log("SKIP  signed-in checks (STAGING_UAT_PASSWORD not set)");
  } else {
    const cookies = new Map<string, string | null>();
    for (const role of ["MANAGEMENT", "SALES", "FINANCE"]) cookies.set(role, await signIn(role));
    for (const [role, cookie] of cookies) report(cookie !== null, `sign-in as ${role}`);

    const mg = cookies.get("MANAGEMENT");
    if (mg) {
      report((await get("/api/me/context", mg)).status === 200, "Management: context loads");
      report((await get(`/api/orgs/${slug}/leads`, mg)).status === 200, "Management: leads list loads");
      report((await get(`/api/orgs/${slug}/payments/summary`, mg)).status === 200, "Management: payments visible");
    }
    const sales = cookies.get("SALES");
    if (sales) {
      report((await get(`/api/orgs/${slug}/leads`, sales)).status === 200, "Sales: leads list loads");
      const s = await get(`/api/orgs/${slug}/payments/summary`, sales);
      report(s.status === 403, "Sales: payments refused (masking)", `HTTP ${s.status}`);
    }
    const fin = cookies.get("FINANCE");
    if (fin) report((await get(`/api/orgs/${slug}/payments/summary`, fin)).status === 200, "Finance: payments visible");
  }

  console.log(failed === 0 ? "\nSmoke suite passed." : `\nSmoke suite FAILED: ${failed} check(s).`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "smoke run failed");
  process.exit(1);
});
