import { execSync } from "node:child_process";
import "dotenv/config";

/** host:port/database only -- never print credentials. */
function describeDatabaseTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "unparseable TEST_DATABASE_URL";
  }
}

/**
 * Runs once, in the main Vitest process, before any test file/worker
 * starts. It points the whole test run at the isolated test database
 * (never the dev database), applies migrations from a clean slate, ensures
 * the least-privilege `figbloom_app` role exists with current grants, and
 * seeds only the global role/permission catalog -- individual test files
 * create their own throwaway organizations (see tests/helpers/fixtures.ts)
 * so tests never collide with each other's data.
 */
export default async function globalSetup(): Promise<void> {
  if (!process.env.TEST_DATABASE_URL || !process.env.TEST_APP_DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL and TEST_APP_DATABASE_URL must be set (see .env.example) before running tests.",
    );
  }

  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.APP_DATABASE_URL = process.env.TEST_APP_DATABASE_URL;

  const env = { ...process.env };

  // Fail loudly, with the fix, if Postgres is unreachable (B0.02). Without
  // this, a missing database surfaces as a cryptic `prisma migrate deploy`
  // error -- or, worse, someone assumes the integration suite "skipped".
  const { adminDb: preflightDb } = await import("../src/db/adminClient");
  const target = describeDatabaseTarget(process.env.TEST_DATABASE_URL);
  try {
    await Promise.race([
      preflightDb.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timed out after 10s")), 10_000),
      ),
    ]);
  } catch (err) {
    const reason = err instanceof Error ? (err.message.trim().split(/\r?\n/).pop() ?? "") : String(err);
    throw new Error(
      `The test database is unreachable (${target}): ${reason}. ` +
        "Start it with `docker compose up -d --wait` (or `npm run test:local`), " +
        "and check TEST_DATABASE_URL in .env. The suite never skips database tests.",
    );
  } finally {
    await preflightDb.$disconnect();
  }

  // AC5 / section 16 "Migration tests: clean database migration succeeds":
  // this runs against whatever state figbloom_crm_test is currently in,
  // which in CI is always freshly created (see docker/init-test-db.sql).
  execSync("npx prisma migrate deploy", { stdio: "inherit", env });
  execSync("npx tsx scripts/db-admin.ts bootstrap-role", {
    stdio: "inherit",
    env,
  });
  execSync("npx tsx scripts/db-admin.ts grant-role", { stdio: "inherit", env });

  const { adminDb } = await import("../src/db/adminClient");
  // Same reconciling sync production runs (B1.01), so a permission removed from
  // the catalogue is removed from the test database too, not left behind.
  const { seedRolesAndPermissions } = await import("../prisma/seedReference");
  await seedRolesAndPermissions();

  await adminDb.$disconnect();
}
