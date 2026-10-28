import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Scratch config (M9 preferences): runs only the Preferences component tests, without the Postgres global setup, so parallel builders do not
// collide on the shared test database. The same files also run under the main config (`npm test`).
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/components/setupComponentTests.ts"],
    include: ["tests/components/screens/preferences/**/*.test.{ts,tsx}"],
    testTimeout: 20000,
  },
});
