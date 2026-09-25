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

module.exports = nextConfig;
