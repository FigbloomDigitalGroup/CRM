import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, middleware } from "../src/middleware";

const APP = "http://localhost:3100";

function req(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`${APP}${path}`, {
    method: init.method ?? "POST",
    headers: { host: "localhost:3100", ...init.headers },
  });
}

describe("CSRF middleware (FIG-802)", () => {
  it("rejects a cross-origin POST to an org route with 403 and the standard envelope", async () => {
    const res = middleware(req("/api/orgs/figbloom/contacts", { headers: { origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("CSRF_REJECTED");
    expect(body.requestId).toBeTruthy();
    expect(res.headers.get("x-request-id")).toBe(body.requestId);
  });

  it("rejects a cross-origin POST to an auth route", () => {
    const res = middleware(req("/api/auth/logout", { headers: { origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("rejects a cross-origin %s", (method) => {
    const res = middleware(req("/api/orgs/figbloom/deals/x", { method, headers: { origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
  });

  it("rejects the opaque 'null' origin and a request with neither Origin nor Referer", () => {
    expect(middleware(req("/api/orgs/figbloom/contacts", { headers: { origin: "null" } })).status).toBe(403);
    expect(middleware(req("/api/orgs/figbloom/contacts")).status).toBe(403);
  });

  it("rejects a look-alike origin that only shares a prefix with the app origin", () => {
    const res = middleware(req("/api/orgs/figbloom/contacts", { headers: { origin: "http://localhost:3100.evil.example" } }));
    expect(res.status).toBe(403);
  });

  it("allows a same-origin POST by Origin", () => {
    const res = middleware(req("/api/orgs/figbloom/contacts", { headers: { origin: APP } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("falls back to Referer when Origin is absent", () => {
    const ok = middleware(req("/api/auth/login", { headers: { referer: `${APP}/login` } }));
    expect(ok.headers.get("x-middleware-next")).toBe("1");
    const bad = middleware(req("/api/auth/login", { headers: { referer: "https://evil.example/login" } }));
    expect(bad.status).toBe(403);
  });

  it("trusts the forwarded host and protocol behind a reverse proxy", () => {
    const res = middleware(
      req("/api/orgs/figbloom/contacts", {
        headers: { origin: "https://crm.figbloom.org", "x-forwarded-host": "crm.figbloom.org", "x-forwarded-proto": "https" },
      }),
    );
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("never lets GET, HEAD or OPTIONS through the check, even cross-origin", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const res = middleware(req("/api/orgs/figbloom/contacts", { method, headers: { origin: "https://evil.example" } }));
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("exempts public API-key and cron endpoints", () => {
    for (const path of ["/api/public/orgs/figbloom/leads", "/api/public/orgs/figbloom/communications/inbound", "/api/cron/notifications-sweep"]) {
      const res = middleware(req(path, { headers: { origin: "https://evil.example" } }));
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("only runs on the cookie-authenticated API prefixes", () => {
    expect(config.matcher).toEqual([
      "/api/orgs/:path*",
      "/api/auth/:path*",
      "/api/me/:path*",
      "/api/session/:path*",
      "/api/platform/:path*",
    ]);
  });

  it("protects the personal session endpoints (B1.04): sign-out-others, revoke, extend", () => {
    for (const [method, path] of [
      ["POST", "/api/session/extend"],
      ["POST", "/api/me/sessions/sign-out-others"],
      ["DELETE", "/api/me/sessions/abc"],
    ] as const) {
      const res = middleware(req(path, { method, headers: { origin: "https://evil.example" } }));
      expect(res.status).toBe(403);
    }
    // Reads stay open: they change nothing.
    expect(
      middleware(req("/api/session", { method: "GET", headers: { origin: "https://evil.example" } })).headers.get(
        "x-middleware-next",
      ),
    ).toBe("1");
  });
});
