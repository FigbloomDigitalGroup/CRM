import "dotenv/config";
import { Client } from "pg";

/**
 * Reconciliation between a SOURCE and a TARGET database (FIG-1127, P1.05; docs/CUTOVER_PLAN.md).
 *
 *   npx tsx scripts/reconcile-counts.ts --source <url> --target <url> [--sample 200] [--org <slug>] [--ignore t1,t2] [--no-sample]
 *   (or RECONCILE_SOURCE_URL / RECONCILE_TARGET_URL in the environment, so no password is typed on a command line)
 *
 * 1. Counts: for every table in the public schema, the row count per organization (tables without an organization_id are counted once, as "(global)").
 * 2. Spot check: for every table with an id, a deterministic sample (the N ids with the smallest md5(id)) is read from the source; the same ids are
 *    read from the target and each row is compared by a content hash over the columns both databases have.
 *
 * It prints table names, organization slugs, counts and ids only: never a row's contents, never a connection string. Exit code 0 means no difference,
 * 1 any difference (or an error). A table that exists on one side only is a difference unless it is in --ignore; a column that exists on one side only
 * is left out of the hash (and listed once). Connect with the schema owner (the administrative URL), not the app role, so row-level security does not hide rows.
 */

export interface ReconcileOptions {
  sample: number;
  org?: string;
  ignore: string[];
  spotCheck: boolean;
}

export interface Difference {
  table: string;
  scope: string; // organization slug, "(global)" or "(sample)"
  kind: "count" | "missing-table" | "missing-row" | "content";
  source?: number;
  target?: number;
  ids?: string[];
}

export interface ReconcileReport {
  tablesCompared: number;
  rowsSource: number;
  rowsTarget: number;
  sampled: number;
  differences: Difference[];
  notes: string[];
}

const ident = (name: string): string => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`Refusing to use unsafe identifier: ${name}`);
  return `"${name}"`;
};

interface TableInfo {
  columns: string[];
  tenant: boolean;
  hasId: boolean;
}

async function describeTables(c: Client): Promise<Map<string, TableInfo>> {
  const { rows } = await c.query<{ table_name: string; column_name: string }>(
    `SELECT c.table_name, c.column_name FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.table_name <> '_prisma_migrations'
      ORDER BY c.table_name, c.ordinal_position`,
  );
  const out = new Map<string, TableInfo>();
  for (const r of rows) {
    const t = out.get(r.table_name) ?? { columns: [], tenant: false, hasId: false };
    t.columns.push(r.column_name);
    if (r.column_name === "organization_id") t.tenant = true;
    if (r.column_name === "id") t.hasId = true;
    out.set(r.table_name, t);
  }
  return out;
}

async function orgSlugs(c: Client): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { rows } = await c.query<{ id: string; slug: string }>(`SELECT id::text AS id, slug FROM organizations`);
    for (const r of rows) map.set(r.id, r.slug);
  } catch {
    /* no organizations table: counts are shown by id */
  }
  return map;
}

async function countsFor(c: Client, table: string, info: TableInfo | undefined, orgId: string | undefined): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!info) return out;
  if (info.tenant) {
    const where = orgId ? `WHERE organization_id::text = $1` : "";
    const { rows } = await c.query<{ k: string; n: string }>(
      `SELECT organization_id::text AS k, count(*)::text AS n FROM ${ident(table)} ${where} GROUP BY 1`,
      orgId ? [orgId] : [],
    );
    for (const r of rows) out.set(r.k, Number(r.n));
  } else if (!orgId) {
    const { rows } = await c.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${ident(table)}`);
    out.set("(global)", Number(rows[0]!.n));
  }
  return out;
}

/** Hash of one row over the given columns: jsonb text is canonical (sorted keys), so the same data gives the same hash on both sides. */
function hashSql(table: string, columns: string[], other: string[]): string {
  const drop = columns.filter((x) => !other.includes(x));
  const expr = drop.length ? `to_jsonb(t) - ARRAY[${drop.map((d) => `'${d.replace(/'/g, "''")}'`).join(",")}]::text[]` : `to_jsonb(t)`;
  return `md5((${expr})::text)`;
}

export async function reconcile(sourceUrl: string, targetUrl: string, opts: ReconcileOptions): Promise<ReconcileReport> {
  const src = new Client({ connectionString: sourceUrl });
  const dst = new Client({ connectionString: targetUrl });
  await src.connect();
  await dst.connect();
  const report: ReconcileReport = { tablesCompared: 0, rowsSource: 0, rowsTarget: 0, sampled: 0, differences: [], notes: [] };
  try {
    const [sInfo, dInfo, sSlugs, dSlugs] = await Promise.all([describeTables(src), describeTables(dst), orgSlugs(src), orgSlugs(dst)]);
    const slug = (id: string) => sSlugs.get(id) ?? dSlugs.get(id) ?? id;
    let orgId: string | undefined;
    if (opts.org) {
      orgId = [...sSlugs].find(([, s]) => s === opts.org)?.[0] ?? [...dSlugs].find(([, s]) => s === opts.org)?.[0];
      if (!orgId) throw new Error(`No organization with slug "${opts.org}" on either side.`);
    }
    const ignore = new Set(opts.ignore);
    const tables = [...new Set([...sInfo.keys(), ...dInfo.keys()])].filter((t) => !ignore.has(t)).sort();

    for (const table of tables) {
      const s = sInfo.get(table);
      const d = dInfo.get(table);
      if (!s || !d) {
        report.differences.push({ table, scope: "(table)", kind: "missing-table", source: s ? 1 : 0, target: d ? 1 : 0 });
        continue;
      }
      report.tablesCompared++;
      const [sc, dc] = await Promise.all([countsFor(src, table, s, orgId), countsFor(dst, table, d, orgId)]);
      for (const key of new Set([...sc.keys(), ...dc.keys()])) {
        const a = sc.get(key) ?? 0;
        const b = dc.get(key) ?? 0;
        report.rowsSource += a;
        report.rowsTarget += b;
        if (a !== b) report.differences.push({ table, scope: key === "(global)" ? key : slug(key), kind: "count", source: a, target: b });
      }

      if (!opts.spotCheck || !s.hasId || !d.hasId || opts.sample <= 0) continue;
      const only = [...s.columns.filter((x) => !d.columns.includes(x)).map((x) => `${table}.${x} (source only)`), ...d.columns.filter((x) => !s.columns.includes(x)).map((x) => `${table}.${x} (target only)`)];
      if (only.length) report.notes.push(`columns left out of the hash: ${only.join(", ")}`);
      const where = orgId && s.tenant ? `WHERE t.organization_id::text = $2` : "";
      const params: unknown[] = [opts.sample, ...(orgId && s.tenant ? [orgId] : [])];
      const sample = await src.query<{ id: string; h: string }>(
        `SELECT t.id::text AS id, ${hashSql(table, s.columns, d.columns)} AS h FROM ${ident(table)} t ${where} ORDER BY md5(t.id::text) LIMIT $1`,
        params,
      );
      if (sample.rows.length === 0) continue;
      report.sampled += sample.rows.length;
      const ids = sample.rows.map((r) => r.id);
      const got = await dst.query<{ id: string; h: string }>(
        `SELECT t.id::text AS id, ${hashSql(table, d.columns, s.columns)} AS h FROM ${ident(table)} t WHERE t.id::text = ANY($1::text[])`,
        [ids],
      );
      const byId = new Map(got.rows.map((r) => [r.id, r.h]));
      const missing = sample.rows.filter((r) => !byId.has(r.id)).map((r) => r.id);
      const changed = sample.rows.filter((r) => byId.has(r.id) && byId.get(r.id) !== r.h).map((r) => r.id);
      if (missing.length) report.differences.push({ table, scope: "(sample)", kind: "missing-row", source: missing.length, ids: missing.slice(0, 5) });
      if (changed.length) report.differences.push({ table, scope: "(sample)", kind: "content", source: changed.length, ids: changed.slice(0, 5) });
    }
    report.notes = [...new Set(report.notes)];
  } finally {
    await src.end();
    await dst.end();
  }
  return report;
}

export function formatReport(r: ReconcileReport): string {
  const lines = [
    `Tables compared: ${r.tablesCompared}. Rows counted: source ${r.rowsSource}, target ${r.rowsTarget}. Rows spot-checked: ${r.sampled}.`,
  ];
  for (const n of r.notes) lines.push(`note: ${n}`);
  for (const d of r.differences) {
    if (d.kind === "count") lines.push(`DIFF count   ${d.table} [${d.scope}]: source ${d.source}, target ${d.target}`);
    else if (d.kind === "missing-table") lines.push(`DIFF table   ${d.table}: exists on ${d.source ? "source" : "target"} only`);
    else lines.push(`DIFF ${d.kind === "content" ? "content" : "missing"} ${d.table}: ${d.source} sampled row(s)${d.kind === "content" ? " differ" : " absent in target"} (ids: ${d.ids?.join(", ")})`);
  }
  lines.push(r.differences.length === 0 ? "RESULT: reconciled, zero differences." : `RESULT: ${r.differences.length} difference(s).`);
  return lines.join("\n");
}

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const opts: ReconcileOptions = {
    sample: Number(get("--sample") ?? 200),
    org: get("--org"),
    ignore: (get("--ignore") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    spotCheck: !argv.includes("--no-sample"),
  };
  const source = get("--source") ?? process.env.RECONCILE_SOURCE_URL;
  const target = get("--target") ?? process.env.RECONCILE_TARGET_URL;
  if (!source || !target) throw new Error("Give --source and --target (or RECONCILE_SOURCE_URL and RECONCILE_TARGET_URL).");
  if (!Number.isInteger(opts.sample) || opts.sample < 0) throw new Error("--sample must be a whole number, 0 or more.");
  return { source, target, opts };
}

async function main(): Promise<void> {
  const { source, target, opts } = parseArgs(process.argv.slice(2));
  const report = await reconcile(source, target, opts);
  console.log(formatReport(report));
  process.exit(report.differences.length === 0 ? 0 : 1);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/reconcile-counts.ts")) {
  main().catch((err) => {
    // Never echo a connection string: pg errors can carry the host and user.
    console.error(err instanceof Error ? err.message : "reconcile failed");
    process.exit(1);
  });
}
