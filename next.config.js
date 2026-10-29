const { withSentryConfig } = require("@sentry/nextjs/config");
const { buildSecurityHeaders } = require("./config/securityHeaders");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `next dev` and `next build` both write to `.next`, so a dev server left running corrupts a production build made beside it (and the
  // other way round). Setting NEXT_DIST_DIR (for example `.next-e2e`) lets the end-to-end build live in its own folder. Unset, nothing changes.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // CI runs the type check as its own parallel job, so its build step sets SKIP_BUILD_TYPECHECK=true and does not repeat it. Anywhere else (a
  // deploy, a local build, the Docker image) the build still refuses to ship a type error.
  typescript: { ignoreBuildErrors: process.env.SKIP_BUILD_TYPECHECK === "true" },
  // Next's own dev-mode build-activity badge defaults to bottom-left,
  // which collides with the app's sidebar user pill there -- dev-only,
  // never shown in production, but move it out of the way so it isn't
  // mistaken for a design element while developing.
  devIndicators: {
    position: "bottom-right",
  },
  // G1.05: clickjacking, MIME sniffing, referrer and browser-feature defaults on every response (see config/securityHeaders.js).
  async headers() {
    return [
      { source: "/:path*", headers: buildSecurityHeaders(process.env.NODE_ENV === "production") },
      // FIG-791, F4.12: the service worker file lives at the site root but may only control the signed-in app (/o/), never the sign-in pages.
      { source: "/sw.js", headers: [{ key: "Service-Worker-Allowed", value: "/o/" }, { key: "Cache-Control", value: "no-cache" }] },
    ];
  },
};

// FIG-753: source map upload (so a Sentry stack trace shows real source,
// not minified build output) needs org/project/authToken -- all three are
// read automatically from the SENTRY_ORG/SENTRY_PROJECT/SENTRY_AUTH_TOKEN
// env vars by the underlying bundler plugin, so there's nothing
// project-specific to hardcode here. No auth token (local dev, CI, or any
// environment that hasn't set one up) just disables the upload step --
// the app and its own Sentry init are completely unaffected either way.
module.exports = withSentryConfig(nextConfig, {
  silent: true,
  disableLogger: true,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
