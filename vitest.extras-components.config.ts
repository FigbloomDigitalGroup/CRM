import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Scratch config (M8, F3.08): runs only the record-extras component tests, without the Postgres global setup, so parallel builders do not
// collide on the shared test database. Safe to delete once M8 is merged.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/components/setupComponentTests.ts"],
    include: ["tests/components/screens/extras/**/*.test.tsx"],
    testTimeout: 20000,
  },
});
