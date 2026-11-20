/**
 * UC-F7: the database and file readers behind the `verify-*` commands. Every query is read-only and returns counts, sums and hashes: no query here
 * selects a column of personal data (a row is turned into text only inside `md5(...)`). Connect with the schema OWNER, so row-level security does
 * not hide rows (the commands check that the role really bypasses it).
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { Client } from "pg";
import type {
  CustomFieldState,
  DuplicateFinding,
  FileCounts,
  FinancialSnapshot,
  ForeignKeyState,
  MoneyGroup,
} from "./dataVerify";

export const ident = (n: string) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(n)) throw new Error(`unsafe identifier ${n}`);
  return `"${n}"`;
};

/** Never lets a connection string or password reach the output. */
export const clean = (e: unknown) => (e as Error).message.split("\n")[0].replace(/postgres(ql)?:\/\/\S+/g, "<url>");

/** One consistent, read-only view of the database for the whole run. */
export async function readOnly<T>(client: Client, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    return await fn();
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
  }
}

export async function bypassesRls(client: Client): Promise<boolean> {
  const r = await client.query(`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`);
  return r.rows[0]?.ok === true;
}

async function tableExists(client: Client, name: string): Promise<boolean> {
  const r = await client.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${name}`]);
  return r.rows[0].ok === true;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Foreign keys

export async function gatherForeignKeys(client: Client): Promise<ForeignKeyState[]> {
  const meta = await client.query(
    `SELECT con.conname AS name, cl.relname AS child, pl.relname AS parent, con.convalidated AS validated,
       (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS child_cols,
       (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS parent_cols
     FROM pg_constraint con
     JOIN pg_class cl ON cl.oid = con.conrelid
     JOIN pg_class pl ON pl.oid = con.confrelid
     JOIN pg_namespace n ON n.oid = cl.relnamespace
     WHERE con.contype = 'f' AND n.nspname = 'public'
     ORDER BY cl.relname, con.conname`,
  );
  const out: ForeignKeyState[] = [];
  for (const r of meta.rows) {
    const childCols = r.child_cols as string[];
    const parentCols = r.parent_cols as string[];
    // MATCH SIMPLE: a row with any key column null is not checked, exactly as Postgres does.
    const notNull = childCols.map((c) => `c.${ident(c)} IS NOT NULL`).join(" AND ");
    const join = childCols.map((c, i) => `p.${ident(parentCols[i])} = c.${ident(c)}`).join(" AND ");
    const q = await client.query(
      `SELECT count(*)::int AS n FROM ${ident(r.child)} c WHERE ${notNull} AND NOT EXISTS (SELECT 1 FROM ${ident(r.parent)} p WHERE ${join})`,
    );
    out.push({ name: r.name, child: r.child, parent: r.parent, childColumns: childCols, parentColumns: parentCols, validated: r.validated, orphans: q.rows[0].n });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Financials

/** Tables whose every row goes into a hash. */
export const MONEY_TABLES = ["invoices", "payment_records", "quotes", "quote_versions", "quote_lines", "deals", "recurring_services"] as const;

const ZERO = "0.00";
const emptyGroup = (): MoneyGroup => ({
  invoices: 0,
  invoicesVoid: 0,
  invoiceAmount: ZERO,
  invoiceAmountVoid: ZERO,
  payments: 0,
  paymentAmount: ZERO,
  paymentsReversed: 0,
  paymentAmountReversed: ZERO,
  outstanding: ZERO,
  quoteVersions: 0,
  quoteTotal: ZERO,
  dealsOpen: 0,
  dealValueOpen: ZERO,
  dealsWon: 0,
  dealValueWon: ZERO,
  dealsLost: 0,
  dealValueLost: ZERO,
});

export async function gatherFinancials(client: Client): Promise<FinancialSnapshot> {
  const groups: Record<string, MoneyGroup> = {};
  const at = (org: string, cur: string) => (groups[`${org}|${cur}`] ??= emptyGroup());

  for (const r of (
    await client.query(
      `SELECT organization_id::text AS org, currency, count(*)::int AS n,
         count(*) FILTER (WHERE status = 'VOID')::int AS void_n,
         coalesce(sum(amount) FILTER (WHERE status <> 'VOID'), 0)::text AS active,
         coalesce(sum(amount) FILTER (WHERE status = 'VOID'), 0)::text AS voided
       FROM invoices GROUP BY 1, 2`,
    )
  ).rows) {
    const g = at(r.org, r.currency);
    g.invoices = r.n;
    g.invoicesVoid = r.void_n;
    g.invoiceAmount = r.active;
    g.invoiceAmountVoid = r.voided;
  }

  for (const r of (
    await client.query(
      `SELECT p.organization_id::text AS org, i.currency, count(*)::int AS n,
         coalesce(sum(p.amount) FILTER (WHERE p.reversed_at IS NULL), 0)::text AS active,
         count(*) FILTER (WHERE p.reversed_at IS NOT NULL)::int AS rev_n,
         coalesce(sum(p.amount) FILTER (WHERE p.reversed_at IS NOT NULL), 0)::text AS reversed
       FROM payment_records p JOIN invoices i ON i.id = p.invoice_id GROUP BY 1, 2`,
    )
  ).rows) {
    const g = at(r.org, r.currency);
    g.payments = r.n;
    g.paymentAmount = r.active;
    g.paymentsReversed = r.rev_n;
    g.paymentAmountReversed = r.reversed;
  }

  for (const r of (
    await client.query(
      `SELECT i.organization_id::text AS org, i.currency,
         coalesce(sum(i.amount - coalesce(pp.paid, 0)), 0)::text AS outstanding
       FROM invoices i
       LEFT JOIN (SELECT invoice_id, sum(amount) AS paid FROM payment_records WHERE reversed_at IS NULL GROUP BY 1) pp ON pp.invoice_id = i.id
       WHERE i.status <> 'VOID' GROUP BY 1, 2`,
    )
  ).rows) {
    at(r.org, r.currency).outstanding = r.outstanding;
  }

  for (const r of (
    await client.query(`SELECT organization_id::text AS org, currency, count(*)::int AS n, coalesce(sum(total), 0)::text AS total FROM quote_versions GROUP BY 1, 2`)
  ).rows) {
    const g = at(r.org, r.currency);
    g.quoteVersions = r.n;
    g.quoteTotal = r.total;
  }

  for (const r of (
    await client.query(`SELECT organization_id::text AS org, currency, outcome::text AS outcome, count(*)::int AS n, coalesce(sum(value), 0)::text AS v FROM deals GROUP BY 1, 2, 3`)
  ).rows) {
    const g = at(r.org, r.currency);
    if (r.outcome === "OPEN") [g.dealsOpen, g.dealValueOpen] = [r.n, r.v];
    else if (r.outcome === "WON") [g.dealsWon, g.dealValueWon] = [r.n, r.v];
    else if (r.outcome === "LOST") [g.dealsLost, g.dealValueLost] = [r.n, r.v];
  }

  const one = async (sql: string) => (await client.query(sql)).rows[0].n as number;
  const inconsistencies = {
    negativeInvoices: await one(`SELECT count(*)::int AS n FROM invoices WHERE amount < 0`),
    negativePayments: await one(`SELECT count(*)::int AS n FROM payment_records WHERE amount < 0`),
    negativeQuoteTotals: await one(`SELECT count(*)::int AS n FROM quote_versions WHERE total < 0`),
    paymentsWithoutInvoice: await one(`SELECT count(*)::int AS n FROM payment_records p WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = p.invoice_id)`),
    paidButOutstanding: await one(
      `SELECT count(*)::int AS n FROM invoices i WHERE i.status = 'PAID'
         AND i.amount - coalesce((SELECT sum(p.amount) FROM payment_records p WHERE p.invoice_id = i.id AND p.reversed_at IS NULL), 0) > 0`,
    ),
    overpaid: await one(
      `SELECT count(*)::int AS n FROM invoices i WHERE i.status <> 'VOID' AND NOT i.allow_overpayment
         AND coalesce((SELECT sum(p.amount) FROM payment_records p WHERE p.invoice_id = i.id AND p.reversed_at IS NULL), 0) > i.amount`,
    ),
    quoteSubtotalMismatch: await one(
      `SELECT count(*)::int AS n FROM quote_versions v
         WHERE EXISTS (SELECT 1 FROM quote_lines l WHERE l.quote_version_id = v.id)
           AND v.subtotal <> (SELECT sum(l.line_total) FROM quote_lines l WHERE l.quote_version_id = v.id)`,
    ),
  };

  const tableHashes: FinancialSnapshot["tableHashes"] = {};
  for (const t of MONEY_TABLES) {
    if (!(await tableExists(client, t))) continue;
    const r = await client.query(
      `SELECT organization_id::text AS org, count(*)::int AS n, md5(string_agg(x::text, '|' ORDER BY x.id)) AS h FROM ${ident(t)} x GROUP BY organization_id`,
    );
    tableHashes[t] = Object.fromEntries(r.rows.map((x) => [x.org, { rows: x.n as number, hash: x.h as string }]));
  }
  return { groups, tableHashes, inconsistencies };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Files (local driver)

export interface FileRow {
  id: string;
  storageKey: string;
  sizeBytes: number;
  checksum: string | null;
  status: string;
  purged: boolean;
}

export async function gatherFileRows(client: Client): Promise<FileRow[]> {
  const r = await client.query(
    `SELECT id::text AS id, storage_key, size_bytes, checksum_sha256, status::text AS status, (purged_at IS NOT NULL) AS purged FROM files ORDER BY md5(id::text)`,
  );
  return r.rows.map((x) => ({ id: x.id, storageKey: x.storage_key, sizeBytes: x.size_bytes, checksum: x.checksum_sha256, status: x.status, purged: x.purged }));
}

async function sha256Of(path: string): Promise<string> {
  const h = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(path).on("data", (c) => h.update(c)).on("end", () => resolve()).on("error", reject);
  });
  return h.digest("hex");
}

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Compares the File rows with the objects under `rootDir` (the local driver keeps `<root>/<storage_key>`). `checksums`: "all", or a number N for the
 * N rows with the smallest md5(id) (the rows come already in that order, so the sample is deterministic and the same on both sides of a move).
 */
export async function inspectLocalFiles(rows: FileRow[], rootDir: string, checksums: "all" | number): Promise<FileCounts> {
  const c: FileCounts = {
    expected: 0, present: 0, missing: 0, sizeMismatch: 0, checksumChecked: 0, checksumMismatch: 0, noChecksum: 0,
    skippedUploading: 0, skippedPurged: 0, orphanObjects: 0, objectsScanned: 0,
  };
  let sampled = 0;
  const known = new Map<string, boolean>(); // storage key -> purged
  for (const r of rows) {
    known.set(r.storageKey, r.purged);
    if (r.purged) {
      c.skippedPurged++;
      continue;
    }
    if (r.status === "UPLOADING") {
      c.skippedUploading++;
      continue;
    }
    c.expected++;
    const path = join(rootDir, ...r.storageKey.split("/"));
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      c.missing++;
      continue;
    }
    c.present++;
    if (size !== r.sizeBytes) c.sizeMismatch++;
    if (!r.checksum) {
      c.noChecksum++;
      continue;
    }
    if (checksums === "all" || sampled < checksums) {
      sampled++;
      c.checksumChecked++;
      if ((await sha256Of(path)) !== r.checksum) c.checksumMismatch++;
    }
  }
  const files = await walk(rootDir);
  for (const f of files) {
    if (f.endsWith(".tmp")) continue; // an upload in flight
    c.objectsScanned++;
    const key = relative(rootDir, f).split(sep).join("/");
    const purged = known.get(key);
    if (purged === undefined || purged === true) c.orphanObjects++;
  }
  return c;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Duplicates

/** Natural keys that must be unique even where no unique index enforces them. Counts of repeated key values only. */
const NATURAL_KEYS: { check: string; table: string; keyExpr: string; optional?: boolean }[] = [
  { check: "user emails (case-insensitive)", table: "users", keyExpr: "lower(email)" },
  { check: "invoice numbers per organisation", table: "invoices", keyExpr: "organization_id::text || '|' || number" },
  { check: "quote numbers per organisation", table: "quotes", keyExpr: "organization_id::text || '|' || number" },
  { check: "memberships per organisation and user", table: "memberships", keyExpr: "organization_id::text || '|' || user_id::text" },
  { check: "custom-field definitions per organisation, entity and key", table: "custom_field_definitions", keyExpr: "organization_id::text || '|' || entity_type::text || '|' || key" },
];

export async function gatherDuplicates(client: Client): Promise<{ findings: DuplicateFinding[]; invalidIndexes: string[]; attributionTables: string[] }> {
  const findings: DuplicateFinding[] = [];
  for (const k of NATURAL_KEYS) {
    if (!(await tableExists(client, k.table))) {
      findings.push({ check: k.check, duplicateKeys: 0, tableMissing: true, optional: k.optional });
      continue;
    }
    const r = await client.query(`SELECT count(*)::int AS n FROM (SELECT ${k.keyExpr} AS k FROM ${ident(k.table)} GROUP BY 1 HAVING count(*) > 1) d`);
    findings.push({ check: k.check, duplicateKeys: r.rows[0].n });
  }
  const invalid = await client.query(
    `SELECT c.relname AS name FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND (NOT i.indisvalid OR NOT i.indisready) ORDER BY 1`,
  );
  const attribution = await client.query(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname ILIKE '%attribution%' ORDER BY 1`,
  );
  return { findings, invalidIndexes: invalid.rows.map((x) => x.name), attributionTables: attribution.rows.map((x) => x.name) };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Custom fields

const CUSTOM_FIELD_TABLES: Record<string, string> = { LEAD: "leads", CONTACT: "contacts", COMPANY: "companies", DEAL: "deals" };

export async function gatherCustomFields(client: Client): Promise<CustomFieldState> {
  const definitions = (await client.query(`SELECT count(*)::int AS n FROM custom_field_definitions`)).rows[0].n as number;
  const values: CustomFieldState["values"] = {};
  // One set-based query per entity table (there can be tens of thousands of definitions: 64 per organisation), not one query per definition.
  for (const [entity, table] of Object.entries(CUSTOM_FIELD_TABLES)) {
    const r = await client.query(
      `SELECT d.id::text AS id, d.key AS key, count(t.id)::int AS n,
              coalesce(md5(string_agg(t.custom_fields ->> d.key, '|' ORDER BY t.id)), '') AS h
       FROM custom_field_definitions d
       LEFT JOIN ${ident(table)} t ON t.organization_id::text = d.organization_id::text AND t.custom_fields ? d.key
       WHERE d.entity_type::text = $1
       GROUP BY d.id, d.key`,
      [entity],
    );
    for (const x of r.rows) values[x.id] = { entity, key: x.key, rows: x.n, hash: x.h };
  }
  let orphanKeys = 0;
  for (const [entity, table] of Object.entries(CUSTOM_FIELD_TABLES)) {
    const r = await client.query(
      `SELECT count(*)::int AS n FROM (SELECT organization_id, jsonb_object_keys(custom_fields) AS k FROM ${ident(table)}) x
       WHERE NOT EXISTS (SELECT 1 FROM custom_field_definitions d WHERE d.organization_id::text = x.organization_id::text AND d.entity_type::text = $1 AND d.key = x.k)`,
      [entity],
    );
    orphanKeys += r.rows[0].n;
  }
  return { definitions, orphanKeys, values };
}
