/* eslint-disable @typescript-eslint/no-require-imports -- a plain Node script, not part of the app bundle */
/**
 * `npm run preview`: builds the app and serves the PRODUCTION build on http://localhost:3000, against your local development database.
 *
 * Why it exists: `npm run dev` compiles every page the first time it is opened and ships unminified code, so it is several times slower than
 * what a user gets. This is the way to see (and measure) the real speed of the site on your own machine.
 *
 * A production server normally refuses to start while dev accounts (the @figbloom.local chips) exist in its database. This script sets the same
 * two-part override the end-to-end suite uses, and ONLY when the database is on this computer; pointed anywhere else it stops. Nothing else in
 * the project sets it, and it is not part of the Docker image.
 *
 * It also builds the dev sign-in chips into THIS build only (Given's approval, 31 Oct 2026; CLAUDE.md rule 10). The build goes to its own
 * folder, `.next-preview`, so the standard `.next` build, the Docker image and CI's build check never contain them. The chips sign in through
 * the real password login, and the dev Super Admin is not offered (its sign-in route stays closed in a production build).
 */
const { spawnSync } = require("node:child_process");
require("dotenv").config?.();

const db = process.env.DATABASE_URL || "";
if (!/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(db)) {
  console.error("preview: DATABASE_URL is not a database on this computer, so the dev-account override is not applied. Stopping.");
  process.exit(1);
}

const env = { STORAGE_DRIVER: "local", STORAGE_SIGNING_SECRET: "local-preview-only-signing-secret-0123456789abcdef", ...process.env, E2E_ALLOW_DEV_ACCOUNTS: "true", ALLOW_DEV_ACCOUNTS: "true", PREVIEW_DEV_CHIPS: "true", NEXT_PUBLIC_PREVIEW_CHIPS: "true", NEXT_DIST_DIR: ".next-preview", NEXT_TELEMETRY_DISABLED: "1" };
const run = (args) => spawnSync(process.execPath, [require.resolve("next/dist/bin/next"), ...args], { stdio: "inherit", env });

if (!process.argv.includes("--skip-build")) {
  const build = run(["build"]);
  if (build.status !== 0) process.exit(build.status ?? 1);
}
process.exit(run(["start"]).status ?? 0);
