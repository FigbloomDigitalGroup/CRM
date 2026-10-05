import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Only used by the component suite below (tests/components/**) -- the
  // Postgres-backed integration suite needs no JSX transform at all.
  plugins: [react()],
  // Mirrors tsconfig.json's "@/*" -> "src/*" path alias, used throughout
  // src/app/** (e.g. src/app/api/health/route.ts). Vitest doesn't read
  // tsconfig paths on its own, so a test importing a route file directly
  // needs this to resolve the same way the Next.js build does.
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    // Component tests (FIG-602) render real React client components and
    // need a DOM; the Postgres-backed service/API integration suite (the
    // rest of tests/**) talks to a real database instead of mocking it
    // (see that suite's own files for why) and has no use for one -- kept
    // on the lighter "node" environment by not matching this glob.
    environmentMatchGlobs: [["tests/components/**", "jsdom"]],
    globalSetup: "./tests/globalSetup.ts",
    setupFiles: ["./tests/setup.ts", "./tests/components/setupComponentTests.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
    // Database tests share one Postgres instance; running files in parallel
    // workers is fine (each test uses uniquely-slugged organizations), but
    // keep it single-threaded to avoid connection-pool exhaustion against
    // the small local dev Postgres container.
    fileParallelism: false,
    // Playwright owns e2e/** (a separate runner, separate config) --
    // without this, Vitest's default test-file glob would also try to
    // collect *.spec.ts there and fail importing `@playwright/test` fixtures.
    exclude: ["e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/generated/**",
      ],
      // FIG-602: a real, currently-passing floor, not an aspirational
      // number nobody hits -- see IMPLEMENTATION_NOTES.md for how this was
      // set and the known shape of the gap (repositories/services are
      // heavily exercised by the 270+ integration tests; most of
      // src/app/**'s route/page files are only exercised through real HTTP
      // -- the e2e suite -- which this Vitest-level report can't see at
      // all, V8 coverage being process-local to whatever ran the code).
      thresholds: {
        lines: 35,
        statements: 35,
        functions: 55,
        branches: 65,
      },
    },
  },
});
