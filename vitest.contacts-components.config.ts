import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Scratch config for the Contacts component tests (F3.02): runs only them, without the Postgres global setup, so parallel builders do not
// collide on the shared test database. Safe to delete once M8 is merged.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/components/setupComponentTests.ts"],
    include: ["tests/components/screens/contacts/**/*.test.tsx"],
    testTimeout: 20000,
  },
});
