import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: "./tests/globalSetup.ts",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
    // Database tests share one Postgres instance; running files in parallel
    // workers is fine (each test uses uniquely-slugged organizations), but
    // keep it single-threaded to avoid connection-pool exhaustion against
    // the small local dev Postgres container.
    fileParallelism: false,
  },
});
