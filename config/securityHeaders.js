/**
 * The response headers every page and API answer carries (G1.05, FIG-1072). Plain CommonJS so `next.config.js` can load it and the
 * test in tests/securityHeaders.test.ts can read exactly what the build serves.
 *
 * The Content-Security-Policy deliberately covers what is safe to enforce without breaking Next's own inline bootstrap scripts:
 * nobody may frame the app, no plug-ins, forms post only to the app, and `<base>` cannot be repointed. A script-src policy needs
 * per-request nonces (a change to every page's rendering), so it is sent as Report-Only first, where it breaks nothing and shows
 * what a strict policy would block.
 *
 * Production only: HSTS (a browser pins it, and a local http:// site must not be pinned).
 */

const ENFORCED_CSP = ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"].join("; ");

const REPORT_ONLY_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function buildSecurityHeaders(production) {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Content-Security-Policy", value: ENFORCED_CSP },
    { key: "Content-Security-Policy-Report-Only", value: REPORT_ONLY_CSP },
  ];
  if (production) headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  return headers;
}

module.exports = { buildSecurityHeaders, ENFORCED_CSP, REPORT_ONLY_CSP };
