import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * AC5 / section 16: migrations must execute successfully, in the correct
 * order, and be re-runnable.
 *
 * Note on "rollback/down migration works where supported" (section 16):
 * Prisma Migrate does not generate reversible down-migrations by default --
 * it is a roll-forward migration tool. The implementation decision taken
 * here (see IMPLEMENTATION_NOTES.md) is to treat "rollback" as "provision a
 * fresh database and re-run `prisma migrate deploy` from migration 1",
 * which is Prisma's own documented recovery pattern, rather than
 * hand-authoring bespoke down.sql for every migration. What IS tested below
 * is that the full migration history applies cleanly, in order, and that
 * re-deploying is a safe no-op.
 */
describe("migrations", () => {
  it("have all been applied, in order, with nothing pending", () => {
    const output = execSync("npx prisma migrate status", {
      env: process.env,
    }).toString();
    expect(output).toContain("Database schema is up to date!");
  });

  it("can be re-deployed against an already-migrated database without error", () => {
    expect(() =>
      execSync("npx prisma migrate deploy", { env: process.env }),
    ).not.toThrow();
  });
});
