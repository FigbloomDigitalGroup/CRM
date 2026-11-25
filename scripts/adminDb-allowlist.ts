/**
 * UC-F4 (Security S-1, part 1). Reads `src/` with the scanner, and:
 *
 *   npx tsx scripts/adminDb-allowlist.ts            print the summary, change nothing
 *   npx tsx scripts/adminDb-allowlist.ts --write    rewrite config/adminDbAllowList.json (keeps a file's category and note once set)
 *                                                   and docs/ADMINDB_CLASSIFICATION.md (a dated snapshot, with file:line for the risky calls)
 *   npx tsx scripts/adminDb-allowlist.ts --check    exit 1 when the allow-list is out of date (the same check the test makes)
 *
 * Run `--write` after you remove or migrate an `adminDb` use (the test makes you: the count only ever goes down). `--write` records what
 * the code does NOW, so a new entry in the diff is the explicit, reviewable decision to allow a new use: it needs a reviewer's say-so, a
 * category, and the file added to the `.eslintrc.json` `excludedFiles` list (docs/ADMINDB_RULE.md). New code does not do this: it uses
 * `withOrgContext`.
 */
import fs from "node:fs";
import path from "node:path";
import {
  ESCAPE_KEY,
  RAW_UNKNOWN_KEY,
  TX_ESCAPE_KEY,
  filesImportingAdminDb,
  readSchemaModels,
  scanAdminDbUses,
  tenantKeys,
  type AdminDbUse,
} from "./lib/adminDbScan";
import { ALL_CATEGORIES, SCAN_EXCLUDED_FILES, defaultCategory, type Category } from "./lib/adminDbCategories";

const root = path.resolve(__dirname, "..");
export const ALLOW_LIST_PATH = path.join(root, "config", "adminDbAllowList.json");
export const DOC_PATH = path.join(root, "docs", "ADMINDB_CLASSIFICATION.md");

export interface AllowEntry {
  file: string;
  /** A tenant model (Prisma delegate name), or one of the three UNKNOWN markers. */
  model: string;
  /** Most uses of this model in this file that are allowed. The test fails above it, and below it (so the list only shrinks). */
  count: number;
  category: Category;
  note?: string;
}

export interface AllowList {
  version: 1;
  entries: AllowEntry[];
}

const WRITE_METHODS = new Set(["update", "updateMany", "delete", "deleteMany", "upsert"]);

export function currentEntries(rootDir = root): { counts: Map<string, number>; uses: AdminDbUse[] } {
  const models = readSchemaModels(rootDir);
  const uses = scanAdminDbUses(rootDir).filter((u) => !SCAN_EXCLUDED_FILES.has(u.file));
  const counts = new Map<string, number>();
  for (const u of uses) for (const key of tenantKeys(u, models)) counts.set(`${u.file}\u0000${key}`, (counts.get(`${u.file}\u0000${key}`) ?? 0) + 1);
  return { counts, uses };
}

export function readAllowList(): AllowList {
  return JSON.parse(fs.readFileSync(ALLOW_LIST_PATH, "utf8")) as AllowList;
}

export function buildAllowList(previous: AllowList | null, counts: Map<string, number>): AllowList {
  const prior = new Map((previous?.entries ?? []).map((e) => [`${e.file}\u0000${e.model}`, e]));
  const entries: AllowEntry[] = [];
  for (const [k, count] of counts) {
    const [file, model] = k.split("\u0000");
    const old = prior.get(k);
    const def = defaultCategory(file);
    const note = old?.note ?? def.note;
    entries.push({ file, model, count, category: old?.category ?? def.category, ...(note ? { note } : {}) });
  }
  entries.sort((a, b) => (a.file === b.file ? (a.model < b.model ? -1 : 1) : a.file < b.file ? -1 : 1));
  return { version: 1, entries };
}

export interface Comparison {
  /** Uses of a tenant model in a file that has no allow-list entry at all: a NEW tenant-data use. */
  added: string[];
  /** Entries whose use count has grown past the allowed count. */
  grown: string[];
  /** Entries that are no longer true (fewer uses, or none): run `--write` to lower or drop them. The list only shrinks. */
  stale: string[];
}

const label = (k: string) => k.replace("\u0000", " -> ");

/** Compares what the code does now with what the allow-list allows. All three lists empty means the code is within the list. */
export function compareToAllowList(counts: Map<string, number>, list: AllowList): Comparison {
  const allowed = new Map(list.entries.map((e) => [`${e.file}\u0000${e.model}`, e.count]));
  const added: string[] = [];
  const grown: string[] = [];
  const stale: string[] = [];
  for (const [k, n] of counts) {
    const a = allowed.get(k);
    if (a === undefined) added.push(`${label(k)} (${n} use${n === 1 ? "" : "s"})`);
    else if (n > a) grown.push(`${label(k)}: ${n} uses, allowed ${a}`);
    else if (n < a) stale.push(`${label(k)}: ${n} uses, list says ${a}`);
  }
  for (const [k, a] of allowed) if (!counts.has(k)) stale.push(`${label(k)}: no uses left, list says ${a}`);
  return { added: added.sort(), grown: grown.sort(), stale: stale.sort() };
}

const area = (file: string) =>
  file.startsWith("src/services/") ? "services"
  : file.startsWith("src/repositories/") ? "repositories"
  : file.startsWith("src/app/") ? "app (routes and pages)"
  : file.startsWith("src/auth/") ? "auth"
  : file.startsWith("src/jobs/") || file.startsWith("src/observability/") ? "jobs and observability"
  : "other (lib, automations, sequences, notifications)";

function buildDoc(list: AllowList, uses: AdminDbUse[], importers: string[]): string {
  const models = readSchemaModels(root);
  const byCat = new Map<Category, { uses: number; files: Set<string> }>();
  for (const c of ALL_CATEGORIES) byCat.set(c, { uses: 0, files: new Set() });
  for (const e of list.entries) {
    const b = byCat.get(e.category)!;
    b.uses += e.count;
    b.files.add(e.file);
  }
  const tenantFiles = new Set(list.entries.map((e) => e.file));
  const tenantUses = list.entries.reduce((n, e) => n + e.count, 0);
  const byKind = (k: string) => uses.filter((u) => u.kind === k).length;

  const riskyWrites = uses.filter((u) => {
    if (u.kind !== "model" || !u.model || !models.tenant.has(u.model) || !u.method || !WRITE_METHODS.has(u.method)) return false;
    const e = list.entries.find((x) => x.file === u.file && x.model === u.model);
    return e?.category === "tenant-data" && (u.scope === "none" || u.scope === "unknown");
  });
  const riskyReads = uses.filter((u) => {
    if (u.kind !== "model" || !u.model || !models.tenant.has(u.model) || !u.method || WRITE_METHODS.has(u.method) || u.method === "create" || u.method === "createMany") return false;
    const e = list.entries.find((x) => x.file === u.file && x.model === u.model);
    return e?.category === "tenant-data" && u.scope === "none";
  });
  const escapes = uses.filter((u) => u.kind === "escape" || u.kind === "tx-escape");
  const unreadableRaw = uses.filter((u) => u.kind === "raw" && u.tables.length === 0);

  const perFile = new Map<string, { n: number; models: Set<string>; cat: Category }>();
  for (const e of list.entries) {
    const f = perFile.get(e.file) ?? { n: 0, models: new Set<string>(), cat: e.category };
    f.n += e.count;
    f.models.add(e.model);
    perFile.set(e.file, f);
  }
  const catCell = (c: Category) => `${byCat.get(c)!.uses} uses in ${byCat.get(c)!.files.size} files`;
  const out: string[] = [];
  out.push("# `adminDb` on tenant data: classification (UC-F4, audit S-1)");
  out.push("");
  out.push("A **snapshot** written by `npx tsx scripts/adminDb-allowlist.ts --write` (it carries no personal data, only file names, model names and counts). The binding, always-current list is `config/adminDbAllowList.json`, enforced by `tests/adminDbAllowList.test.ts`. The rule is in [ADMINDB_RULE.md](ADMINDB_RULE.md).");
  out.push("");
  out.push("`adminDb` is the schema-owner Prisma client: row-level security (RLS) does not apply to it, so a query on tenant data through it is safe only while its own `where` names the organisation. UC-F5 moves the tenant-data sites to `withOrgContext`.");
  out.push("");
  out.push("## Totals");
  out.push("");
  out.push(`- Files under \`src/\` that import \`adminDb\`: **${importers.length}**. Files that use it (outside \`src/db/adminClient.ts\`): **${new Set(uses.map((u) => u.file)).size}**.`);
  out.push(`- Uses found: **${uses.length}** (${byKind("model")} model calls, ${byKind("raw")} raw SQL calls, ${byKind("escape")} places where \`adminDb\` is passed or assigned, ${byKind("tx-escape")} where a transaction client is passed on). The audit's "about 95 call sites" counted the services that hit tenant models; this counts every call.`);
  out.push(`- Schema: **${models.tenant.size}** tenant models (they carry \`organizationId\`, plus the organisation itself) and **${models.global.size}** global models (users, sessions, roles, platform tables, ...). Uses of global models are not tenant data and are not listed.`);
  out.push(`- Uses on tenant data (including raw SQL on tenant tables and the UNKNOWN markers below): **${tenantUses}** in **${tenantFiles.size}** files.`);
  out.push("");
  out.push("| Category | Meaning | Uses on tenant data |");
  out.push("|---|---|---|");
  out.push(`| identity | sign-in, session, two-step, membership and organisation lookups | ${catCell("identity")} |`);
  out.push(`| bootstrap | organisation provisioning, reference data, lifecycle | ${catCell("bootstrap")} |`);
  out.push(`| platform | platform console, support access, health probe | ${catCell("platform")} |`);
  out.push(`| cron-claim | background jobs and sweeps that find work across organisations | ${catCell("cron-claim")} |`);
  out.push(`| **tenant-data** | business records read or written on the owner connection: UC-F5 migrates these | **${catCell("tenant-data")}** |`);
  out.push("");
  out.push("The first four are **allowed**. The classification is by file and deliberately narrow: a file that mixes a legitimate lookup with business-record access is counted as `tenant-data` (UC-F5 splits it). A category was assigned from the file's purpose and a read of its calls, not by running it; **UNKNOWN** is stated where the code could not tell.");
  out.push("");
  out.push("## Tenant-data uses by area");
  out.push("");
  out.push("| Area | Files | Uses |");
  out.push("|---|---|---|");
  const areas = new Map<string, { files: Set<string>; n: number }>();
  for (const e of list.entries.filter((x) => x.category === "tenant-data")) {
    const a = areas.get(area(e.file)) ?? { files: new Set<string>(), n: 0 };
    a.files.add(e.file);
    a.n += e.count;
    areas.set(area(e.file), a);
  }
  for (const [name, a] of [...areas.entries()].sort((x, y) => y[1].n - x[1].n)) out.push(`| ${name} | ${a.files.size} | ${a.n} |`);
  out.push("");
  out.push("## Review first: writes with no organisation in the filter");
  out.push("");
  out.push(`${riskyWrites.length} \`update\`, \`updateMany\`, \`delete\`, \`deleteMany\` or \`upsert\` calls on tenant models, in \`tenant-data\` files, whose \`where\` does not name the organisation (\`none\`) or could not be read (\`unknown\`). Many follow an earlier organisation-scoped fetch of the same row and are fine today; each is a cross-tenant write if a refactor drops that fetch. This is a hint for the reviewer, not a verdict.`);
  out.push("");
  out.push("| Where | Call | Filter |");
  out.push("|---|---|---|");
  for (const u of riskyWrites) out.push(`| \`${u.file}:${u.line}\` | \`${u.model}.${u.method}\` | ${u.scope} |`);
  out.push("");
  out.push("## Reads with no organisation in the filter");
  out.push("");
  out.push(`${riskyReads.length} reads on tenant models in \`tenant-data\` files whose \`where\` is an object literal that does not name the organisation (for example a lookup by \`id\` after a scoped fetch, or a global key). Per file, with the line of each call:`);
  out.push("");
  const readsByFile = new Map<string, AdminDbUse[]>();
  for (const u of riskyReads) readsByFile.set(u.file, [...(readsByFile.get(u.file) ?? []), u]);
  for (const [f, list2] of [...readsByFile.entries()].sort((a, b) => b[1].length - a[1].length)) out.push(`- \`${f}\` (${list2.length}): ${list2.map((u) => `${u.model}.${u.method}:${u.line}`).join(", ")}`);
  out.push("");
  out.push("## UNKNOWN: places the scanner cannot follow");
  out.push("");
  out.push(`${escapes.length} places where \`adminDb\` (or a transaction client) is passed to another function or stored, so the models used by the callee are not visible here, and ${unreadableRaw.length} raw SQL calls whose tables could not be read. They are counted under \`${ESCAPE_KEY}\`, \`${TX_ESCAPE_KEY}\` and \`${RAW_UNKNOWN_KEY}\` in the allow-list and need a person to read them in UC-F5:`);
  out.push("");
  for (const u of [...escapes, ...unreadableRaw].filter((u) => !SCAN_EXCLUDED_FILES.has(u.file))) out.push(`- \`${u.file}:${u.line}\` (${u.kind === "raw" ? "raw SQL, tables unreadable" : u.kind})`);
  out.push("");
  out.push("## Reviewed by hand: `src/services/churnHintService.ts` (named in FIG-1768)");
  out.push("");
  out.push("The issue asked whether the raw SQL near line 92 (the activity counts per customer) has an organisation filter. **It does, and no cross-tenant gap was found.** Read in full on 20 Nov 2026:");
  out.push("");
  out.push("- The raw query filters `c.organization_id = <organisation>` and `c.id IN (<ids>)`; both joins are tied to the same organisation (`a.organization_id = c.organization_id`, `ct.organization_id = c.organization_id`). The ids come from an earlier `company.findMany` that also filters by organisation.");
  out.push("- Every other read, and `resolveGone`'s `updateMany`, names the organisation in its `where`.");
  out.push("- **Fragile, not broken:** three writes use a bare id, `churnHint.update({ where: { id } })` at the refresh (an id from the organisation-filtered `open` list) and in `dismissChurnHint` and `rateChurnHint` (both after `loadVisibleHint`, which filters by `ctx.organizationId`). They are safe only because of that earlier lookup; a refactor that drops it becomes a cross-tenant write. UC-F5 should move this service to `withOrgContext`, or make those updates `updateMany` with the organisation in the filter.");
  out.push("- The existing test `tests/churnHints.test.ts` (\"tenant isolation\") proves that another organisation's list, dismiss and feedback return nothing or NotFound. It does not prove that the nightly refresh of one organisation leaves another's hints alone; by the code it does, and no test was added in this issue (no behaviour change here).");
  out.push("");
  out.push("## Every file, by category");
  out.push("");
  for (const c of ALL_CATEGORIES) {
    const files = [...perFile.entries()].filter(([, v]) => v.cat === c).sort((a, b) => b[1].n - a[1].n);
    out.push(`### ${c} (${files.length} files)`);
    out.push("");
    for (const [f, v] of files) {
      const note = list.entries.find((e) => e.file === f && e.note)?.note;
      out.push(`- \`${f}\`: ${v.n} (${[...v.models].sort().join(", ")})${note ? ` _${note}_` : ""}`);
    }
    out.push("");
  }
  return out.join("\n");
}

function main() {
  const mode = process.argv[2];
  const { counts, uses } = currentEntries();
  const previous = fs.existsSync(ALLOW_LIST_PATH) ? readAllowList() : null;
  const next = buildAllowList(previous, counts);
  const text = JSON.stringify(next, null, 2) + "\n";
  if (mode === "--check") {
    const diff = previous ? compareToAllowList(counts, previous) : { added: ["(no allow-list yet)"], grown: [], stale: [] };
    const same = diff.added.length + diff.grown.length + diff.stale.length === 0;
    console.log(same ? "adminDb allow-list is up to date." : "adminDb allow-list is OUT OF DATE:");
    for (const [title, items] of [["new tenant-data use, not on the list", diff.added], ["more uses than allowed", diff.grown], ["no longer true (lower it with --write)", diff.stale]] as const) {
      if (items.length) console.log(`  ${title}:\n${items.map((i) => `    ${i}`).join("\n")}`);
    }
    process.exit(same ? 0 : 1);
  }
  if (mode === "--write") {
    fs.mkdirSync(path.dirname(ALLOW_LIST_PATH), { recursive: true });
    fs.writeFileSync(ALLOW_LIST_PATH, text);
    fs.writeFileSync(DOC_PATH, buildDoc(next, uses, filesImportingAdminDb(root)) + "\n");
    console.log(`wrote ${path.relative(root, ALLOW_LIST_PATH)} (${next.entries.length} entries) and ${path.relative(root, DOC_PATH)}`);
    return;
  }
  const cats = new Map<Category, number>();
  for (const e of next.entries) cats.set(e.category, (cats.get(e.category) ?? 0) + e.count);
  console.log(`entries: ${next.entries.length}; uses by category:`, JSON.stringify(Object.fromEntries(cats)));
}

// Runs only when started as a script (npx tsx scripts/adminDb-allowlist.ts), not when the test imports the functions above.
if (process.argv[1] && /adminDb-allowlist\.ts$/.test(process.argv[1])) main();
