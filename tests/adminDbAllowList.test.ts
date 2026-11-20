import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareToAllowList, currentEntries, readAllowList } from "../scripts/adminDb-allowlist";
import { ALL_CATEGORIES } from "../scripts/lib/adminDbCategories";
import { filesImportingAdminDb, readSchemaModels, scanFile, tenantKeys } from "../scripts/lib/adminDbScan";

/**
 * UC-F4 (Security S-1, part 1). `adminDb` is the schema-owner client and bypasses row-level security, so new code must not read or write
 * tenant data through it: it uses `withOrgContext`. The ~500 existing tenant-data uses are grandfathered in `config/adminDbAllowList.json`
 * (UC-F5 migrates them). This test fails on any new one, on any file that gains uses, and on a list that has not been lowered after a
 * migration. See docs/ADMINDB_RULE.md and docs/ADMINDB_CLASSIFICATION.md.
 */
const root = path.resolve(__dirname, "..");
const FIX =
  "New code reads and writes tenant data through withOrgContext (src/db/orgScopedClient.ts), not adminDb. If this use really is identity, bootstrap, platform or a cron claim, " +
  "get it reviewed, then add it with `npx tsx scripts/adminDb-allowlist.ts --write` and the file to the no-restricted-imports list in .eslintrc.json (docs/ADMINDB_RULE.md).";

const list = readAllowList();

describe("adminDb allow-list (UC-F4, audit S-1)", () => {
  const { counts } = currentEntries(root);
  const diff = compareToAllowList(counts, list);

  it("no file uses adminDb on a tenant model unless it is on the allow-list", () => {
    expect(diff.added, `New adminDb use on tenant data.\n${FIX}`).toEqual([]);
  });

  it("no allow-listed file uses adminDb on tenant data more than the list allows", () => {
    expect(diff.grown, `adminDb use on tenant data has grown.\n${FIX}`).toEqual([]);
  });

  it("the allow-list only shrinks: an entry that is no longer true is lowered or dropped", () => {
    expect(diff.stale, "A use was removed or migrated: run `npx tsx scripts/adminDb-allowlist.ts --write` and review the diff, so the list keeps tracking the code.").toEqual([]);
  });

  it("every entry names a real file, a known category, a positive count, and appears once", () => {
    const seen = new Set<string>();
    for (const e of list.entries) {
      expect(fs.existsSync(path.join(root, e.file)), `${e.file} does not exist`).toBe(true);
      expect(ALL_CATEGORIES, `${e.file}: category ${e.category}`).toContain(e.category);
      expect(e.count).toBeGreaterThan(0);
      const key = `${e.file}\u0000${e.model}`;
      expect(seen.has(key), `duplicate entry ${e.file} ${e.model}`).toBe(false);
      seen.add(key);
    }
  });

  it("the ESLint no-restricted-imports exclusion list is exactly the files that import the owner client", () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, ".eslintrc.json"), "utf8")) as { overrides: { excludedFiles?: string[]; rules?: Record<string, unknown> }[] };
    const override = cfg.overrides.find((o) => o.rules && "no-restricted-imports" in o.rules);
    expect(override, "the .eslintrc.json override with no-restricted-imports for db/adminClient is missing").toBeTruthy();
    // The repo writes a bracketed folder as `[[]name[]]` in these lists.
    const listed = (override!.excludedFiles ?? []).map((f) => f.replace(/\[\[\]/g, "[").replace(/\[\]\]/g, "]")).sort();
    expect(listed).toEqual(filesImportingAdminDb(root));
  });

  it("every allowed category is a deliberate choice: only tenant-data files are open to migration", () => {
    const byFile = new Map<string, Set<string>>();
    for (const e of list.entries) byFile.set(e.file, new Set([...(byFile.get(e.file) ?? []), e.category]));
    for (const [file, cats] of byFile) expect(cats.size, `${file} mixes categories ${[...cats].join(", ")}`).toBe(1);
  });
});

describe("the adminDb scanner (proves the allow-list would catch a new use)", () => {
  /** A throwaway repository with a two-model schema and one new source file. */
  function fixture(source: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "admindb-scan-"));
    fs.mkdirSync(path.join(dir, "prisma"), { recursive: true });
    fs.mkdirSync(path.join(dir, "src", "services"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "prisma", "schema.prisma"),
      [
        "model Organization {\n  id String @id\n}",
        'model Company {\n  id String @id\n  organizationId String\n  @@map("companies")\n}',
        "model User {\n  id String @id\n}",
      ].join("\n"),
    );
    const file = path.join(dir, "src", "services", "newThing.ts");
    fs.writeFileSync(file, `import { adminDb } from "../db/adminClient";\n${source}\n`);
    return { dir, file };
  }

  it("sees a tenant model call with no organisation in the filter, and ignores global models", () => {
    const { dir, file } = fixture(`
      export async function a(id: string) { await adminDb.company.update({ where: { id }, data: {} }); }
      export async function b() { return adminDb.user.findMany(); }
    `);
    const models = readSchemaModels(dir);
    const uses = scanFile(dir, file);
    const keys = uses.flatMap((u) => tenantKeys(u, models));
    expect(keys).toEqual(["company"]);
    expect(uses.find((u) => u.model === "company")?.scope).toBe("none");
  });

  it("sees a tenant model call through a transaction, raw SQL on a tenant table, and an escape", () => {
    const { dir, file } = fixture(`
      export async function a(id: string, organizationId: string) {
        await adminDb.$transaction(async (tx) => { await tx.company.delete({ where: { id, organizationId } }); });
        await adminDb.$queryRaw\`SELECT * FROM companies WHERE id = \${id}\`;
        helper(adminDb);
      }
      declare function helper(x: unknown): void;
    `);
    const models = readSchemaModels(dir);
    const uses = scanFile(dir, file);
    const keys = uses.flatMap((u) => tenantKeys(u, models)).sort();
    expect(keys).toEqual(["$adminDb-escape", "company", "company"]);
    expect(uses.find((u) => u.kind === "model")?.scope).toBe("org");
  });

  it("a new file with a tenant-data call is reported as added against the real allow-list, and as an unlisted importer", () => {
    const { dir, file } = fixture(`export async function a(id: string) { await adminDb.company.findFirst({ where: { id } }); }`);
    const models = readSchemaModels(dir);
    const counts = new Map<string, number>();
    for (const u of scanFile(dir, file)) for (const k of tenantKeys(u, models)) counts.set(`src/services/newThing.ts\u0000${k}`, 1);
    const result = compareToAllowList(counts, list);
    expect(result.added).toEqual(["src/services/newThing.ts -> company (1 use)"]);
    expect(filesImportingAdminDb(dir)).toEqual(["src/services/newThing.ts"]);
  });
});
