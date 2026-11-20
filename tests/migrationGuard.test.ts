import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { judge, scanMigration } from "../scripts/lib/migrationGuard";

const none = new Set<string>();
const rules = (sql: string) => scanMigration(sql).findings.map((f) => f.rule);

describe("migration guard (FIG-1603)", () => {
  it("fails a migration that drops a column", () => {
    const v = judge("x", 'ALTER TABLE "leads" DROP COLUMN "phone";', none);
    expect(v.ok).toBe(false);
    expect(v.problems.join("\n")).toContain("drop-column");
  });

  it.each([
    ['DROP TABLE "a";', "drop-table"],
    ['DROP TABLE IF EXISTS "a";', "drop-table"],
    ['ALTER TABLE "a" DROP COLUMN IF EXISTS "b";', "drop-column"],
    ['ALTER TABLE "a" DROP "b";', "drop-column"],
    ['TRUNCATE TABLE "a";', "truncate"],
    ['TRUNCATE "a" CASCADE;', "truncate"],
    ['DELETE FROM "a";', "delete-without-where"],
    ['ALTER TABLE "a" ALTER COLUMN "b" TYPE TEXT;', "alter-column-type"],
    ['ALTER TABLE "a" ALTER COLUMN "b" SET DATA TYPE INTEGER USING b::integer;', "alter-column-type"],
    ['ALTER TABLE "a" RENAME COLUMN "b" TO "c";', "rename"],
    ['ALTER TABLE "a" RENAME TO "z";', "rename"],
    ['DROP SCHEMA public CASCADE;', "drop-schema"],
  ])("flags %s", (sql, rule) => {
    expect(rules(sql)).toContain(rule);
  });

  it("allows additive and safe statements", () => {
    const sql = `
      CREATE TABLE "t" ("id" TEXT PRIMARY KEY);
      ALTER TABLE "t" ADD COLUMN "n" INTEGER;
      ALTER TABLE "t" ALTER COLUMN "n" SET DEFAULT 1;
      ALTER TABLE "t" ALTER COLUMN "n" SET NOT NULL;
      ALTER TABLE "t" DROP CONSTRAINT "t_fk";
      DROP INDEX "t_idx";
      DROP POLICY IF EXISTS p ON "t";
      CREATE TRIGGER no_truncate BEFORE TRUNCATE ON "t" FOR EACH STATEMENT EXECUTE FUNCTION f();
      DELETE FROM "t" WHERE "id" = 'x';
      UPDATE "t" SET "n" = 2;
    `;
    expect(rules(sql)).toEqual([]);
    expect(judge("x", sql, none).ok).toBe(true);
  });

  it("ignores comments and string literals", () => {
    const sql = `-- DROP TABLE a;\n/* DROP COLUMN b */ INSERT INTO "x" VALUES ('DROP TABLE y; DELETE FROM z');`;
    expect(rules(sql)).toEqual([]);
  });

  it("sees a DELETE without WHERE inside a DO block", () => {
    expect(rules(`DO $$ BEGIN DELETE FROM "a"; END $$;`)).toContain("delete-without-where");
  });

  it("passes with a complete approval line and fails with an incomplete one", () => {
    const stmt = 'ALTER TABLE "a" DROP COLUMN "b";';
    const ok = `-- migration-guard: approved-by=Given reason=column unused since 2026, data exported first\n${stmt}`;
    expect(judge("x", ok, none).ok).toBe(true);
    const noReason = `-- migration-guard: approved-by=Given\n${stmt}`;
    const v = judge("x", noReason, none);
    expect(v.ok).toBe(false);
    expect(v.problems.join("\n")).toContain("incomplete");
    expect(judge("x", `-- migration-guard: reason=because I said so\n${stmt}`, none).ok).toBe(false);
  });

  it("does not judge grandfathered migrations", () => {
    expect(judge("old", 'DROP TABLE "a";', new Set(["old"])).ok).toBe(true);
  });

  it("every migration in the repository passes", () => {
    const root = join(__dirname, "..", "prisma");
    const baseline = new Set<string>(JSON.parse(readFileSync(join(root, "migrations-guard-baseline.json"), "utf8")).migrations);
    const bad: string[] = [];
    for (const d of readdirSync(join(root, "migrations"), { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const v = judge(d.name, readFileSync(join(root, "migrations", d.name, "migration.sql"), "utf8"), baseline);
      if (!v.ok) bad.push(`${d.name}: ${v.problems.join("; ")}`);
    }
    expect(bad).toEqual([]);
  });
});
