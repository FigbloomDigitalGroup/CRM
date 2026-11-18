import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Scratch config for the mobile and PWA (M9, F4.10 to F4.12) component tests: runs without the Postgres global setup, so parallel builders
// do not collide on the shared test database. The same files also run in the full suite.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/components/setupComponentTests.ts"],
    include: ["tests/components/mobile/**/*.test.{ts,tsx}"],
    testTimeout: 20000,
  },
});
