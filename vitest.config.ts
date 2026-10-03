import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirrors tsconfig.json's "@/*" -> "src/*" path alias, used throughout
  // src/app/** (e.g. src/app/api/health/route.ts). Vitest doesn't read
  // tsconfig paths on its own, so a test importing a route file directly
  // needs this to resolve the same way the Next.js build does.
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
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
