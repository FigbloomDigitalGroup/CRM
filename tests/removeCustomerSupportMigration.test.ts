import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

/**
 * FIG-1565: migration 20261120090000_remove_customer_support used to fail on a database that held work belonging to the
 * Customer Support dev member (tasks assigned to it, activities it wrote, ...), because the foreign keys to memberships do not
 * cascade. This builds a scratch database at the state just before that migration, adds such work, runs the migration, and checks
 * that the work moved to a Management member, that the support account and role are gone, and that a second run changes nothing.
 */
const admin = process.env.DATABASE_URL!;
const withDb = (name: string) => admin.replace(/\/[^/?]+(\?|$)/, `/${name}$1`);
const DB = "figbloom_scratch_1565";
const MIGRATIONS = path.join(__dirname, "..", "prisma", "migrations");
const TARGET = "20261120090000_remove_customer_support";
const migrationSql = (name: string) => readFileSync(path.join(MIGRATIONS, name, "migration.sql"), "utf8");

let db: Client;

async function one(sql: string, params: unknown[] = []) {
  const { rows } = await db.query(sql, params);
  return rows;
}

describe("remove_customer_support migration with work owned by the support member (FIG-1565)", () => {
  beforeAll(async () => {
    const control = new Client({ connectionString: admin });
    await control.connect();
    await control.query(`DROP DATABASE IF EXISTS ${DB}`);
    await control.query(`CREATE DATABASE ${DB}`);
    await control.end();

    db = new Client({ connectionString: withDb(DB) });
    await db.connect();
    const before = readdirSync(MIGRATIONS, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name < TARGET)
      .map((d) => d.name)
      .sort();
    for (const name of before) await db.query(migrationSql(name));

    await db.query(`
      INSERT INTO roles(id,key,name,updated_at) VALUES ('r_mgmt','MANAGEMENT','Management',now()),('r_sales','SALES','Sales',now()),('r_cs','CUSTOMER_SUPPORT','Customer Support',now());
      INSERT INTO organizations(id,name,slug,updated_at) VALUES ('o1','Dev Org','dev-org-1565',now()),('o2','Lonely Org','lonely-org-1565',now());
      INSERT INTO users(id,email,name,updated_at) VALUES
        ('u_mgmt','mgmt@figbloom.local','Mgmt',now()),('u_cs','support@figbloom.local','Support',now()),
        ('u_sales','sales@figbloom.local','Sales',now()),('u_cs2','support2@example.test','Support 2',now());
      INSERT INTO memberships(id,organization_id,user_id,role_id,status,joined_at,created_at,updated_at) VALUES
        ('m_mgmt','o1','u_mgmt','r_mgmt','ACTIVE','2026-01-01',now(),now()),
        ('m_cs','o1','u_cs','r_cs','ACTIVE','2026-01-02',now(),now()),
        ('m_sales','o1','u_sales','r_sales','ACTIVE','2026-01-03',now(),now()),
        ('m_cs2','o2','u_cs2','r_cs','ACTIVE','2026-01-02',now(),now());
      INSERT INTO tasks(id,organization_id,title,assignee_membership_id,created_by_membership_id,updated_at) VALUES
        ('t1','o1','Assigned to support','m_cs','m_sales',now()),
        ('t2','o1','Created by support','m_sales','m_cs',now()),
        ('t3','o1','Both','m_cs','m_cs',now());
      INSERT INTO companies(id,organization_id,name,created_by_membership_id,owner_membership_id,updated_at) VALUES ('c1','o1','Acme','m_cs','m_cs',now());
      INSERT INTO activities(id,organization_id,type,author_membership_id,company_id) VALUES ('a1','o1','NOTE','m_cs','c1');
      INSERT INTO audit_events(id,organization_id,actor_membership_id,action,entity_type) VALUES ('ae1','o1','m_cs','x.y','Z');
      INSERT INTO page_views(id,organization_id,membership_id,page) VALUES ('pv1','o1','m_cs','/x');
    `);
  }, 180_000);

  afterAll(async () => {
    await db?.end();
    const control = new Client({ connectionString: admin });
    await control.connect();
    await control.query(`DROP DATABASE IF EXISTS ${DB}`);
    await control.end();
  });

  it("runs on a database holding that work without failing (the first run)", async () => {
    // Organisation o2 holds a support member and no one else; it owns nothing, so it must not block the migration.
    await db.query(migrationSql(TARGET));
    expect(await one(`SELECT 1 FROM memberships WHERE id = 'm_cs2'`)).toEqual([]);
  });

  it("moves the work to the organisation's Management member and removes the support account and role", async () => {
    expect(await one(`SELECT id, assignee_membership_id AS a, created_by_membership_id AS c FROM tasks ORDER BY id`)).toEqual([
      { id: "t1", a: "m_mgmt", c: "m_sales" },
      { id: "t2", a: "m_sales", c: "m_mgmt" },
      { id: "t3", a: "m_mgmt", c: "m_mgmt" },
    ]);
    expect(await one(`SELECT author_membership_id AS a FROM activities WHERE id = 'a1'`)).toEqual([{ a: "m_mgmt" }]);
    // Optional references are cleared, the member's own page views are deleted, the audit event stays without an actor.
    expect(await one(`SELECT created_by_membership_id AS c, owner_membership_id AS o FROM companies WHERE id = 'c1'`)).toEqual([{ c: null, o: null }]);
    expect(await one(`SELECT actor_membership_id AS a FROM audit_events WHERE id = 'ae1'`)).toEqual([{ a: null }]);
    expect(await one(`SELECT count(*)::int AS n FROM page_views`)).toEqual([{ n: 0 }]);

    expect(await one(`SELECT key FROM roles WHERE key = 'CUSTOMER_SUPPORT'`)).toEqual([]);
    expect(await one(`SELECT id FROM users WHERE id IN ('u_cs','u_cs2')`)).toEqual([]);
    expect((await one(`SELECT id FROM memberships ORDER BY id`)).map((r) => r.id)).toEqual(["m_mgmt", "m_sales"]);
  });

  it("is safe to run twice", async () => {
    const snapshot = async () => ({
      tasks: await one(`SELECT id, assignee_membership_id, created_by_membership_id FROM tasks ORDER BY id`),
      memberships: await one(`SELECT id FROM memberships ORDER BY id`),
      users: await one(`SELECT id FROM users ORDER BY id`),
    });
    const before = await snapshot();
    await db.query(migrationSql(TARGET));
    expect(await snapshot()).toEqual(before);
  });

  it("stops with a clear message when work belongs to a support member and no one else in that organisation can take it", async () => {
    await db.query(`
      INSERT INTO roles(id,key,name,updated_at) VALUES ('r_cs_b','CUSTOMER_SUPPORT','Customer Support',now());
      INSERT INTO organizations(id,name,slug,updated_at) VALUES ('o3','Stuck Org','stuck-org-1565',now());
      INSERT INTO users(id,email,name,updated_at) VALUES ('u_cs3','support3@example.test','Support 3',now());
      INSERT INTO memberships(id,organization_id,user_id,role_id,status,joined_at,created_at,updated_at) VALUES ('m_cs3','o3','u_cs3','r_cs_b','ACTIVE','2026-01-02',now(),now());
      INSERT INTO tasks(id,organization_id,title,assignee_membership_id,created_by_membership_id,updated_at) VALUES ('t9','o3','Orphan','m_cs3','m_cs3',now());
    `);
    await expect(db.query(migrationSql(TARGET))).rejects.toThrow(/no other active member to take it over/);
  });
});
