import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { formatReport, reconcile } from "../scripts/reconcile-counts";

/** FIG-1127: the reconciliation script finds a missing row, a changed row and a missing table, and passes on identical data. Uses two scratch databases. */
const admin = process.env.DATABASE_URL!;
const withDb = (name: string) => admin.replace(/\/[^/?]+(\?|$)/, `/${name}$1`);
const A = "figbloom_scratch_1127_src";
const B = "figbloom_scratch_1127_dst";
const opts = { sample: 50, ignore: [] as string[], spotCheck: true };

async function exec(url: string, sql: string[]) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    for (const s of sql) await c.query(s);
  } finally {
    await c.end();
  }
}
const schema = [
  `CREATE TABLE organizations (id uuid PRIMARY KEY, slug text)`,
  `CREATE TABLE leads (id uuid PRIMARY KEY, organization_id uuid, name text, note text)`,
  `CREATE TABLE roles (id uuid PRIMARY KEY, name text)`,
];
const data = [
  `INSERT INTO organizations VALUES ('00000000-0000-0000-0000-00000000000a','acme'),('00000000-0000-0000-0000-00000000000b','beta')`,
  `INSERT INTO leads SELECT gen_random_uuid(), CASE WHEN g % 2 = 0 THEN '00000000-0000-0000-0000-00000000000a'::uuid ELSE '00000000-0000-0000-0000-00000000000b'::uuid END, 'n' || g, NULL FROM generate_series(1,40) g`,
  `INSERT INTO roles VALUES (gen_random_uuid(), 'x')`,
];

describe("reconcile-counts", () => {
  beforeAll(async () => {
    for (const db of [A, B]) {
      await exec(admin, [`DROP DATABASE IF EXISTS ${db}`, `CREATE DATABASE ${db}`]);
      await exec(withDb(db), schema);
    }
    await exec(withDb(A), data);
  });
  afterAll(async () => {
    await exec(admin, [`DROP DATABASE IF EXISTS ${A}`, `DROP DATABASE IF EXISTS ${B}`]);
  });

  async function copy() {
    // Copy the source rows into the target through the client (no dump tool needed).
    const s = new Client({ connectionString: withDb(A) });
    const t = new Client({ connectionString: withDb(B) });
    await s.connect();
    await t.connect();
    await t.query(`CREATE TABLE IF NOT EXISTS roles (id uuid PRIMARY KEY, name text)`);
    for (const table of ["organizations", "leads", "roles"]) {
      await t.query(`DELETE FROM ${table}`);
      const { rows } = await s.query(`SELECT to_jsonb(x) AS j FROM ${table} x`);
      for (const r of rows) await t.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table}, $1::jsonb)`, [JSON.stringify(r.j)]);
    }
    await s.end();
    await t.end();
  }

  it("reports zero differences on identical data and prints no row contents", async () => {
    await copy();
    const r = await reconcile(withDb(A), withDb(B), opts);
    expect(r.differences).toEqual([]);
    expect(r.sampled).toBeGreaterThan(0);
    expect(formatReport(r)).toContain("zero differences");
    expect(formatReport(r)).not.toMatch(/postgresql:|n\d+/);
  });

  it("finds a missing row (count and sample), a changed row and a missing table", async () => {
    await copy();
    await exec(withDb(B), [`DELETE FROM leads WHERE id = (SELECT id FROM leads ORDER BY name LIMIT 1)`]);
    let r = await reconcile(withDb(A), withDb(B), opts);
    expect(r.differences.some((d) => d.kind === "count" && d.table === "leads" && d.source! - d.target! === 1)).toBe(true);
    expect(r.differences.some((d) => d.kind === "missing-row")).toBe(true);

    await copy();
    await exec(withDb(B), [`UPDATE leads SET note = 'changed' WHERE id = (SELECT id FROM leads ORDER BY name LIMIT 1)`]);
    r = await reconcile(withDb(A), withDb(B), { ...opts, sample: 1000 });
    expect(r.differences.map((d) => d.kind)).toEqual(["content"]);

    await copy();
    await exec(withDb(B), [`DROP TABLE roles`]);
    r = await reconcile(withDb(A), withDb(B), opts);
    expect(r.differences).toEqual([{ table: "roles", scope: "(table)", kind: "missing-table", source: 1, target: 0 }]);
    r = await reconcile(withDb(A), withDb(B), { ...opts, ignore: ["roles"] });
    expect(r.differences).toEqual([]);
  });

  it("narrows to one organization", async () => {
    await copy();
    await exec(withDb(B), [`DELETE FROM leads WHERE organization_id = '00000000-0000-0000-0000-00000000000b'`]);
    expect((await reconcile(withDb(A), withDb(B), { ...opts, org: "acme" })).differences).toEqual([]);
    expect((await reconcile(withDb(A), withDb(B), { ...opts, org: "beta" })).differences.length).toBeGreaterThan(0);
  });
});
