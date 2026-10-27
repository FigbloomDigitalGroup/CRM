import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { buildSecurityHeaders } = require("../config/securityHeaders.js") as {
  buildSecurityHeaders: (production: boolean) => { key: string; value: string }[];
};

const valueOf = (headers: { key: string; value: string }[], key: string) => headers.find((h) => h.key === key)?.value;

describe("security headers (G1.05)", () => {
  it("stops framing, MIME sniffing and plug-ins, and limits the referrer and browser features, everywhere", () => {
    for (const production of [false, true]) {
      const headers = buildSecurityHeaders(production);
      expect(valueOf(headers, "X-Content-Type-Options")).toBe("nosniff");
      expect(valueOf(headers, "X-Frame-Options")).toBe("DENY");
      expect(valueOf(headers, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(valueOf(headers, "Permissions-Policy")).toContain("camera=()");
      const csp = valueOf(headers, "Content-Security-Policy")!;
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
      expect(csp).toContain("form-action 'self'");
    }
  });

  it("sends the script policy as report-only, so nothing the app needs is blocked while it is tightened", () => {
    const headers = buildSecurityHeaders(true);
    expect(valueOf(headers, "Content-Security-Policy")).not.toContain("script-src");
    expect(valueOf(headers, "Content-Security-Policy-Report-Only")).toContain("script-src");
  });

  it("pins HTTPS only in production, so a local http site is never pinned", () => {
    expect(valueOf(buildSecurityHeaders(true), "Strict-Transport-Security")).toContain("max-age=31536000");
    expect(valueOf(buildSecurityHeaders(false), "Strict-Transport-Security")).toBeUndefined();
  });

  it("is what the Next build actually serves", () => {
    const config = readFileSync("next.config.js", "utf8");
    expect(config).toContain('require("./config/securityHeaders")');
    expect(config).toContain('source: "/:path*"');
    expect(config).toContain("buildSecurityHeaders(");
  });

  it("travels with next.config.js into the production image, which loads it when it starts", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).toMatch(/COPY\s+package\.json\s+next\.config\.js/);
    expect(dockerfile).toMatch(/COPY\s+config\s+\.\/config/);
  });
});
