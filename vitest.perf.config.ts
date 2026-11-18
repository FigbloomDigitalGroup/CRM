import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

/** G1.04: the scale measurements (tests/perf), kept out of `npm test`. Run: npx vitest run --config vitest.perf.config.ts */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["tests/perf/**/*.perf.ts"],
      globalSetup: ["./tests/perf/globalSetup.ts"],
      testTimeout: 1_800_000,
      hookTimeout: 600_000,
      coverage: { enabled: false },
    },
  }),
);
