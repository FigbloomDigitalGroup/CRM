import { execSync } from "node:child_process";
import "dotenv/config";

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
  const { ROLES, PERMISSIONS, ROLE_PERMISSIONS } =
    await import("../prisma/seedData");

  for (const role of ROLES) {
    await adminDb.role.upsert({
      where: { key: role.key },
      update: {},
      create: role,
    });
  }
  for (const permission of PERMISSIONS) {
    await adminDb.permission.upsert({
      where: { key: permission.key },
      update: {},
      create: permission,
    });
  }
  for (const [roleKey, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await adminDb.role.findUniqueOrThrow({
      where: { key: roleKey },
    });
    for (const permissionKey of permissionKeys) {
      const permission = await adminDb.permission.findUniqueOrThrow({
        where: { key: permissionKey },
      });
      await adminDb.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId: permission.id },
        },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  await adminDb.$disconnect();
}
