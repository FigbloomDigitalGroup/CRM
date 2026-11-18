import "dotenv/config";
import { spawnSync } from "node:child_process";

/**
 * Applies migrations through the direct (non-pooled) connection of a hosted database (docs/DEPLOYMENT.md, "Production
 * database bring-up"). Poolers such as the one in front of Neon cannot run Prisma's migration locks, so migrations
 * must use the direct URL. Prisma's `directUrl` datasource option is deliberately not used: it makes `DIRECT_URL`
 * mandatory for every Prisma command (generate, validate, the test suite). This script maps `DIRECT_URL` onto the
 * `DATABASE_URL` that Prisma already reads, for this one command only. With `DIRECT_URL` unset it behaves exactly like
 * `npm run migrate:deploy`. Never run automatically by a Vercel build.
 */
const direct = process.env.DIRECT_URL?.trim();
const env = { ...process.env, ...(direct ? { DATABASE_URL: direct } : {}) };
if (!env.DATABASE_URL) {
  console.error("Set DIRECT_URL (hosted database, owner role, non-pooled) or DATABASE_URL.");
  process.exit(1);
}
const result = spawnSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env, shell: process.platform === "win32" });
process.exit(result.status ?? 1);
