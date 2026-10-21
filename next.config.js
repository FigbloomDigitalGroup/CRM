const { withSentryConfig } = require("@sentry/nextjs/config");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next's own dev-mode build-activity badge defaults to bottom-left,
  // which collides with the app's sidebar user pill there -- dev-only,
  // never shown in production, but move it out of the way so it isn't
  // mistaken for a design element while developing.
  devIndicators: {
    position: "bottom-right",
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
