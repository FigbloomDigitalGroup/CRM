/**
 * UC-F7: the pure part of the data-preservation checks (architecture doc 18.5). No database, no file access, no connection string:
 * the gatherers are in `dataVerifyDb.ts` and the commands are `scripts/verify-*.ts`.
 *
 * Everything printed is a table name, a column name, an organisation id, a count, a sum of money or a hash. Never a row's contents.
 */
import type { Check, VerifyReport } from "./migrationVerify";

export type { Check, VerifyReport };

const list = (xs: string[], n = 6) => (xs.length > n ? `${xs.slice(0, n).join(", ")} and ${xs.length - n} more` : xs.join(", "));

export function reportOf(checks: Check[]): VerifyReport {
  return { ok: checks.every((c) => c.ok), checks, totalRows: 0 };
}

/** Same layout as the migration report; the rows-in-total tail only appears when a command gives a total. */
export function formatChecks(title: string, r: VerifyReport, tail?: string): string {
  const lines = [title, ...r.checks.map((c) => `${c.skipped ? "SKIP" : c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`)];
  const run = r.checks.filter((c) => !c.skipped);
  lines.push("", `${r.ok ? "PASS" : "FAIL"}  ${run.filter((c) => c.ok).length} of ${run.length} checks${tail ? `, ${tail}` : ""}`);
  return lines.join("\n");
}

/** The owner connection must see every row: a role held back by forced row-level security would make every count partial. */
export function ownerCheck(bypassesRls: boolean): Check {
  return {
    name: "Owner connection sees every row",
    ok: bypassesRls,
    detail: bypassesRls ? "the connecting role bypasses row-level security" : "the connecting role does NOT bypass row-level security: every count here may be partial (see UC-F6)",
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Foreign keys and orphans (verify-relations)

export interface ForeignKeyState {
  name: string;
  child: string;
  parent: string;
  childColumns: string[];
  parentColumns: string[];
  /** Postgres has validated the constraint (a `NOT VALID` constraint may hold orphans). */
  validated: boolean;
  /** Rows of the child table whose key columns are all set and match no row of the parent table. */
  orphans: number;
}

export function evaluateRelations(fks: ForeignKeyState[], bypassesRls: boolean): VerifyReport {
  const composite = fks.filter((f) => f.childColumns.length > 1);
  const notValid = fks.filter((f) => !f.validated).map((f) => `${f.child}.${f.name}`);
  const orphaned = fks.filter((f) => f.orphans > 0);
  const orphanRows = orphaned.reduce((n, f) => n + f.orphans, 0);
  return reportOf([
    ownerCheck(bypassesRls),
    {
      name: "Foreign keys found",
      ok: fks.length > 0,
      detail: `${fks.length} foreign keys, ${composite.length} of them composite (organisation plus id)`,
    },
    {
      name: "Every foreign key is validated",
      ok: notValid.length === 0,
      detail: notValid.length ? `not validated: ${list(notValid)}` : "all validated",
    },
    {
      name: "Zero orphan rows",
      ok: orphanRows === 0,
      detail: orphanRows ? `${orphanRows} orphan rows in ${orphaned.length} keys: ${list(orphaned.map((f) => `${f.child}.${f.name} (${f.orphans})`))}` : `${fks.length} keys resolved, 0 orphans`,
    },
  ]);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Fingerprints: a flat map of "what the data adds up to", written before and compared after. Values are strings so money never meets a float.

export type Fingerprint = Record<string, string>;

export interface FingerprintDiff {
  changed: string[];
  missing: string[];
  added: string[];
}

export function diffFingerprints(before: Fingerprint, now: Fingerprint): FingerprintDiff {
  const changed: string[] = [];
  const missing: string[] = [];
  for (const [k, v] of Object.entries(before)) {
    if (!(k in now)) missing.push(k);
    else if (now[k] !== v) changed.push(k);
  }
  const added = Object.keys(now).filter((k) => !(k in before));
  return { changed, missing, added };
}

export function compareCheck(name: string, before: Fingerprint | undefined, now: Fingerprint, what: string): Check {
  if (!before) {
    return { name, ok: true, skipped: true, detail: `no ${what} snapshot given: pass --compare <file> from the other side to prove equality` };
  }
  const d = diffFingerprints(before, now);
  const bad = d.changed.length + d.missing.length + d.added.length;
  return {
    name,
    ok: bad === 0,
    detail: bad
      ? `${d.changed.length} changed, ${d.missing.length} missing, ${d.added.length} new: ${list([...d.changed, ...d.missing, ...d.added], 5)}`
      : `${Object.keys(before).length} ${what} values identical`,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Financials (verify-financials)

/** Money per organisation and currency, every amount as the exact decimal text Postgres gave. */
export interface MoneyGroup {
  invoices: number;
  invoicesVoid: number;
  invoiceAmount: string;
  invoiceAmountVoid: string;
  payments: number;
  paymentAmount: string;
  paymentsReversed: number;
  paymentAmountReversed: string;
  outstanding: string;
  quoteVersions: number;
  quoteTotal: string;
  dealsOpen: number;
  dealValueOpen: string;
  dealsWon: number;
  dealValueWon: string;
  dealsLost: number;
  dealValueLost: string;
}

export interface FinancialInconsistencies {
  negativeInvoices: number;
  negativePayments: number;
  negativeQuoteTotals: number;
  paymentsWithoutInvoice: number;
  /** Invoices marked PAID that still have something outstanding. */
  paidButOutstanding: number;
  /** Active payments above the invoice amount where overpayment is not allowed. */
  overpaid: number;
  /** Quote versions whose subtotal is not the sum of their lines. */
  quoteSubtotalMismatch: number;
}

export interface TableHash {
  rows: number;
  hash: string;
}

export interface FinancialSnapshot {
  /** key: `${organisationId}|${currency}` */
  groups: Record<string, MoneyGroup>;
  /** key: table, then organisation id. Every row of a money table goes into its hash (md5 over the rows in id order). */
  tableHashes: Record<string, Record<string, TableHash>>;
  inconsistencies: FinancialInconsistencies;
}

export function flattenFinancials(s: FinancialSnapshot): Fingerprint {
  const out: Fingerprint = {};
  for (const [key, g] of Object.entries(s.groups)) {
    for (const [field, value] of Object.entries(g)) out[`money|${key}|${field}`] = String(value);
  }
  for (const [table, byOrg] of Object.entries(s.tableHashes)) {
    for (const [org, h] of Object.entries(byOrg)) {
      out[`rows|${table}|${org}`] = String(h.rows);
      out[`hash|${table}|${org}`] = h.hash;
    }
  }
  return out;
}

export function evaluateFinancials(s: FinancialSnapshot, bypassesRls: boolean, before?: Fingerprint): VerifyReport {
  const i = s.inconsistencies;
  const problems: string[] = [];
  if (i.negativeInvoices) problems.push(`${i.negativeInvoices} invoices with a negative amount`);
  if (i.negativePayments) problems.push(`${i.negativePayments} payments with a negative amount`);
  if (i.negativeQuoteTotals) problems.push(`${i.negativeQuoteTotals} quote versions with a negative total`);
  if (i.paymentsWithoutInvoice) problems.push(`${i.paymentsWithoutInvoice} payments with no invoice`);
  if (i.paidButOutstanding) problems.push(`${i.paidButOutstanding} invoices marked PAID with an amount still outstanding`);
  if (i.overpaid) problems.push(`${i.overpaid} invoices paid above their amount without allowing overpayment`);
  if (i.quoteSubtotalMismatch) problems.push(`${i.quoteSubtotalMismatch} quote versions whose subtotal differs from their lines`);
  const groups = Object.keys(s.groups).length;
  const hashed = Object.values(s.tableHashes).reduce((n, byOrg) => n + Object.values(byOrg).reduce((m, h) => m + h.rows, 0), 0);
  const flat = flattenFinancials(s);
  return reportOf([
    ownerCheck(bypassesRls),
    {
      name: "Money is internally consistent",
      ok: problems.length === 0,
      detail: problems.length ? problems.join("; ") : `${groups} organisation and currency groups: no negative amount, no orphan payment, no overpayment, quote subtotals match their lines`,
    },
    {
      name: "Money tables hashed in full",
      ok: true,
      detail: `${Object.keys(s.tableHashes).length} tables, ${hashed} rows, every row in the hash (not a sample)`,
    },
    compareCheck("Totals and row hashes equal the other side", before, flat, "financial"),
  ]);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Files (verify-files)

export interface FileCounts {
  /** File rows that are not purged and not still uploading: an object is expected for each. */
  expected: number;
  present: number;
  missing: number;
  sizeMismatch: number;
  checksumChecked: number;
  checksumMismatch: number;
  /** Rows with no checksum recorded (nothing to compare). */
  noChecksum: number;
  skippedUploading: number;
  skippedPurged: number;
  /** Objects in the store that no row points at, plus objects still present for a purged row. */
  orphanObjects: number;
  objectsScanned: number;
}

export function evaluateFiles(c: FileCounts, opts: { failOnOrphans?: boolean; driver: string }): VerifyReport {
  return reportOf([
    {
      name: "Storage driver can be inspected",
      ok: opts.driver === "local",
      detail: opts.driver === "local" ? "local driver: objects read from the storage directory" : `driver "${opts.driver}" is not supported by this check yet: run it against the local driver or a copy of the objects`,
    },
    {
      name: "Every non-purged file has its object",
      ok: c.missing === 0,
      detail: c.missing ? `${c.missing} of ${c.expected} objects missing` : `${c.present} of ${c.expected} present (${c.skippedUploading} still uploading and ${c.skippedPurged} purged rows left out)`,
    },
    {
      name: "Every object has the recorded size",
      ok: c.sizeMismatch === 0,
      detail: c.sizeMismatch ? `${c.sizeMismatch} objects with a different size` : `${c.present - c.sizeMismatch} sizes match`,
    },
    {
      name: "Checksums match",
      ok: c.checksumMismatch === 0,
      detail: c.checksumMismatch ? `${c.checksumMismatch} of ${c.checksumChecked} checked objects differ from checksum_sha256` : `${c.checksumChecked} checked, all match (${c.noChecksum} rows record no checksum)`,
    },
    {
      name: opts.failOnOrphans ? "No orphan objects" : "Orphan objects (reported, not a failure)",
      ok: opts.failOnOrphans ? c.orphanObjects === 0 : true,
      detail: `${c.orphanObjects} orphan objects of ${c.objectsScanned} scanned`,
    },
  ]);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Duplicates (verify-duplicates)

export interface DuplicateFinding {
  check: string;
  /** Number of key values that occur more than once. */
  duplicateKeys: number;
  /** The table was not there. A missing table FAILS the check (a restore that lost it must not pass) unless `optional` says it belongs to a later release. */
  tableMissing?: boolean;
  /** The table belongs to a later release: while it is missing the check is skipped, not failed. */
  optional?: boolean;
}

export function evaluateDuplicates(findings: DuplicateFinding[], invalidIndexes: string[], attributionTables: string[], bypassesRls: boolean): VerifyReport {
  const checks: Check[] = [ownerCheck(bypassesRls)];
  checks.push({
    name: "Every index is valid",
    ok: invalidIndexes.length === 0,
    detail: invalidIndexes.length ? `invalid or not ready: ${list(invalidIndexes)} (a unique index that is not valid does not stop duplicates)` : "all indexes valid and ready",
  });
  for (const f of findings) {
    checks.push(
      f.tableMissing
        ? f.optional
          ? { name: `No duplicate ${f.check}`, ok: true, skipped: true, detail: "table belongs to a later release and is not there yet" }
          : { name: `No duplicate ${f.check}`, ok: false, detail: "the table is missing from this database (a migration or restore lost it)" }
        : { name: `No duplicate ${f.check}`, ok: f.duplicateKeys === 0, detail: f.duplicateKeys ? `${f.duplicateKeys} keys occur more than once` : "none" },
    );
  }
  checks.push(
    attributionTables.length === 0
      ? { name: "No duplicate attribution rows", ok: true, skipped: true, detail: "no attribution tables exist yet (UC-C8 builds them): nothing to check" }
      : { name: "No duplicate attribution rows", ok: false, detail: `attribution tables exist (${list(attributionTables)}) but this check does not know their keys yet: add them to ATTRIBUTION_KEYS in scripts/lib/dataVerifyDb.ts` },
  );
  return reportOf(checks);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Custom fields (verify-custom-fields)

export interface CustomFieldState {
  /** Definitions found. */
  definitions: number;
  /** Value occurrences whose key has no definition in that organisation and entity. */
  orphanKeys: number;
  /** key: `${definitionId}` -> count and hash of the values. */
  values: Record<string, { entity: string; key: string; rows: number; hash: string }>;
}

export function flattenCustomFields(s: CustomFieldState): Fingerprint {
  const out: Fingerprint = {};
  for (const [id, v] of Object.entries(s.values)) {
    out[`cf-rows|${id}|${v.entity}.${v.key}`] = String(v.rows);
    out[`cf-hash|${id}|${v.entity}.${v.key}`] = v.hash;
  }
  return out;
}

export function evaluateCustomFields(s: CustomFieldState, bypassesRls: boolean, before?: Fingerprint): VerifyReport {
  const withValues = Object.values(s.values).filter((v) => v.rows > 0).length;
  return reportOf([
    ownerCheck(bypassesRls),
    {
      name: "Custom-field values counted and hashed per definition",
      ok: true,
      detail: `${s.definitions} definitions, ${withValues} with at least one value`,
    },
    {
      name: "Every stored value has a definition",
      ok: s.orphanKeys === 0,
      detail: s.orphanKeys ? `${s.orphanKeys} values whose key has no definition` : "no orphan keys",
    },
    compareCheck("Value counts and hashes equal the other side", before, flattenCustomFields(s), "custom-field"),
  ]);
}
