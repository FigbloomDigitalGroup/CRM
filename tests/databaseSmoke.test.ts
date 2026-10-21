import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { getUnscopedAppClientForTests } from "../src/db/orgScopedClient";

/**
 * B0.02 smoke test: the first thing to fail, loudly, if the database the
 * rest of the suite depends on is not what it should be. There is no
 * skip/`runIf` anywhere in this file on purpose -- an unreachable database
 * must turn the run red, never silently green. (tests/globalSetup.ts also
 * refuses to start the suite when Postgres can't be reached.)
 */
describe("database smoke test (B0.02)", () => {
  it("is reachable as the admin role and is the isolated test database", async () => {
    const [row] = await adminDb.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    expect(row.db).toMatch(/test/);
    expect(row.db).toBe(new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1));
  });

  it("is reachable as the least-privilege figbloom_app role", async () => {
    const [row] = await getUnscopedAppClientForTests().$queryRaw<
      { who: string }[]
    >`SELECT current_user AS who`;
    expect(row.who).toBe("figbloom_app");
  });

  it("figbloom_app can neither bypass RLS nor own the schema", async () => {
    const [role] = await adminDb.$queryRaw<
      { rolsuper: boolean; rolbypassrls: boolean }[]
    >`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'figbloom_app'`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("has every migration applied", async () => {
    const [row] = await adminDb.$queryRaw<{ pending: bigint }[]>`
      SELECT count(*) AS pending FROM _prisma_migrations WHERE finished_at IS NULL`;
    expect(Number(row.pending)).toBe(0);
  });

  it("has row-level security enabled and forced on every tenant table", async () => {
    const tenantTables = await adminDb.$queryRaw<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN information_schema.columns col
        ON col.table_name = c.relname
       AND col.table_schema = 'public'
       AND col.column_name = 'organization_id'
      WHERE c.relkind = 'r'
      ORDER BY c.relname`;

    // Guards against the query silently matching nothing.
    expect(tenantTables.length).toBeGreaterThan(0);
    const unprotected = tenantTables
      .filter((t) => !t.relrowsecurity || !t.relforcerowsecurity)
      .map((t) => t.relname);
    expect(unprotected).toEqual([]);
  });

  it("has the global role and permission catalog seeded", async () => {
    const [roles, permissions] = await Promise.all([
      adminDb.role.count(),
      adminDb.permission.count(),
    ]);
    expect(roles).toBeGreaterThan(0);
    expect(permissions).toBeGreaterThan(0);
  });
});
