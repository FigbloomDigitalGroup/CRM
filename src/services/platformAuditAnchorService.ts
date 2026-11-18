import { createHash } from "node:crypto";

/**
 * The platform audit anchor (FIG-1566, finding F-03 of docs/SECURITY_REVIEW_PLATFORM_CONSOLE.md).
 *
 * The platform audit log is hash-chained by a database trigger, but the chain lives in the same database as the rows, so someone who owns
 * the database could rewrite the whole log consistently. The answer is a copy outside the database: the backup carries an export of the
 * log and the head of its chain, and the restore check compares that copy with what comes back.
 *
 * This file is the restore check. It holds no database code: the export (`ops/backup/audit-export.sql`) hands over the exact text
 * Postgres feeds to the hash, and `rowHash` recomputes it with the same recipe as `platform_audit_row_hash()` in migration
 * 20261105100000_platform_console_backend (SHA-256 of the fields joined with U+001F). A test proves the two agree on real rows.
 *
 * Export format, one JSON object per line: `kind: "row"` lines in `seq` order, then one `kind: "head"` line (row count, head seq, head
 * hash). The head line is also kept as a small separate file so it can be stored somewhere the log's owner cannot reach.
 */

export interface AnchorRow {
  kind: "row";
  seq: string;
  id: string;
  occurred_text: string;
  actor_identity_id: string | null;
  actor_label: string;
  action: string;
  target_type: string;
  target_id: string | null;
  organization_id: string | null;
  organization_slug: string | null;
  reason: string | null;
  metadata_text: string;
  request_id: string | null;
  prev_hash: string;
  hash: string;
}

export interface AnchorHead {
  rows: number;
  headSeq: number;
  headHash: string;
}

export interface VerifiedHead {
  headSeq: number;
  headHash: string;
  runAt: string;
}

export interface ParsedAnchor {
  rows: AnchorRow[];
  /** The head the export says it has, or null when the file has no head line (cut off). */
  head: AnchorHead | null;
}

export class AnchorFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnchorFormatError";
  }
}

export const GENESIS = "GENESIS";
const UNIT_SEPARATOR = "\x1f";
const SHA256_HEX = /^[0-9a-f]{64}$/;

const ROW_STRING_FIELDS = ["seq", "id", "occurred_text", "actor_label", "action", "target_type", "metadata_text", "prev_hash", "hash"] as const;
const ROW_NULLABLE_FIELDS = ["actor_identity_id", "target_id", "organization_id", "organization_slug", "reason", "request_id"] as const;

/** The same recipe as `platform_audit_row_hash()`: nullable fields count as empty, the rest are joined as given. */
export function rowHash(row: AnchorRow): string {
  const text = [
    row.prev_hash,
    row.seq,
    row.id,
    row.occurred_text,
    row.actor_identity_id ?? "",
    row.actor_label,
    row.action,
    row.target_type,
    row.target_id ?? "",
    row.organization_id ?? "",
    row.organization_slug ?? "",
    row.reason ?? "",
    row.metadata_text,
    row.request_id ?? "",
  ].join(UNIT_SEPARATOR);
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function asInteger(value: unknown, what: string): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new AnchorFormatError(`${what} is not a whole number.`);
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new AnchorFormatError(`${what} is too large.`);
  return n;
}

function parseHeadObject(o: Record<string, unknown>): AnchorHead {
  const headHash = o.head_hash;
  if (typeof headHash !== "string" || !(headHash === GENESIS || SHA256_HEX.test(headHash))) throw new AnchorFormatError("The head hash is not a SHA-256 value.");
  return { rows: asInteger(o.rows, "The head's row count"), headSeq: asInteger(o.head_seq, "The head's seq"), headHash };
}

/** Reads the export. Lines that are not valid are an error, never skipped: a damaged copy must not pass as a shorter one. */
export function parseAnchor(text: string): ParsedAnchor {
  const rows: AnchorRow[] = [];
  let head: AnchorHead | null = null;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.trim() === "") return;
    const at = `Line ${index + 1}`;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new AnchorFormatError(`${at} is not valid JSON.`);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new AnchorFormatError(`${at} is not an object.`);
    const o = parsed as Record<string, unknown>;
    if (head) throw new AnchorFormatError(`${at} comes after the head line: the file was appended to.`);
    if (o.kind === "head") {
      head = parseHeadObject(o);
      return;
    }
    if (o.kind !== "row") throw new AnchorFormatError(`${at} has an unknown kind.`);
    for (const f of ROW_STRING_FIELDS) if (typeof o[f] !== "string") throw new AnchorFormatError(`${at}: "${f}" is missing.`);
    for (const f of ROW_NULLABLE_FIELDS) if (o[f] !== null && typeof o[f] !== "string") throw new AnchorFormatError(`${at}: "${f}" is not text or null.`);
    asInteger(o.seq, `${at}: seq`);
    rows.push(o as unknown as AnchorRow);
  });
  return { rows, head };
}

/** The separate head file: the export's last line, kept somewhere else. */
export function parseHeadFile(text: string): AnchorHead {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length !== 1) throw new AnchorFormatError("A head file holds exactly one line.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[0]!);
  } catch {
    throw new AnchorFormatError("The head file is not valid JSON.");
  }
  if (parsed === null || typeof parsed !== "object" || (parsed as { kind?: unknown }).kind !== "head") throw new AnchorFormatError("The head file does not hold a head line.");
  return parseHeadObject(parsed as Record<string, unknown>);
}

export function parseVerifiedHead(text: string): VerifiedHead | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return null;
  if (lines.length > 1) throw new AnchorFormatError("A verified-head file holds at most one line.");
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(lines[0]!) as Record<string, unknown>;
  } catch {
    throw new AnchorFormatError("The verified-head file is not valid JSON.");
  }
  if (o.kind !== "verified_head" || typeof o.head_hash !== "string" || typeof o.run_at !== "string") throw new AnchorFormatError("The verified-head file is not a verified head.");
  return { headSeq: asInteger(o.head_seq, "The verified head's seq"), headHash: o.head_hash, runAt: o.run_at };
}

export interface AnchorCheck {
  ok: boolean;
  rowsChecked: number;
  headSeq: number;
  headHash: string;
  /** The first row where the copy does not hold (or the first missing one), or null. */
  firstBadSeq: number | null;
  problems: string[];
}

export interface AnchorExpectations {
  /** The head file kept apart from the export. */
  storedHead?: AnchorHead | null;
  /** The head the last passing verification run recorded in the database at export time. */
  verifiedHead?: VerifiedHead | null;
}

/**
 * Recomputes the chain from the exported rows and compares the head with every stored copy of it. A copy that cannot be shown to be
 * whole is a failure, never a pass: no rows and no head line is "cut off", not "empty".
 */
export function checkAnchor(anchor: ParsedAnchor, expect: AnchorExpectations = {}): AnchorCheck {
  const problems: string[] = [];
  let firstBad: number | null = null;
  const flag = (seq: number | null, text: string) => {
    problems.push(text);
    if (seq !== null && firstBad === null) firstBad = seq;
  };

  const { rows } = anchor;
  let previousHash = GENESIS;
  let previousSeq = 0;
  for (const row of rows) {
    const seq = Number(row.seq);
    if (seq !== previousSeq + 1) {
      if (seq <= previousSeq) flag(seq, `Row ${seq} is out of order or repeated.`);
      else flag(previousSeq + 1, `Rows are missing after ${previousSeq}: they were removed.`);
    }
    if (row.prev_hash !== previousHash) {
      flag(seq, previousSeq === 0 ? `Row ${seq} should start the log but does not: earlier rows were removed.` : `Row ${seq} does not follow the row before it: the chain was broken.`);
    }
    if (!SHA256_HEX.test(row.hash) || rowHash(row) !== row.hash) flag(seq, `Row ${seq} does not match its hash: it was changed.`);
    previousHash = row.hash;
    previousSeq = seq;
  }

  const headSeq = previousSeq;
  const headHash = previousHash;

  const recorded = anchor.head;
  if (!recorded) flag(null, "The export has no head line: it was cut off.");
  else {
    if (recorded.rows !== rows.length) flag(null, `The head line counts ${recorded.rows} rows but the file holds ${rows.length}: rows were removed or added.`);
    if (recorded.headSeq !== headSeq || recorded.headHash !== headHash) flag(null, "The head line does not match the last row of the file.");
  }

  const stored = expect.storedHead;
  if (stored) {
    if (stored.rows !== rows.length || stored.headSeq !== headSeq || stored.headHash !== headHash) {
      flag(null, `The stored head (seq ${stored.headSeq}, ${stored.rows} rows) is not the head of this export (seq ${headSeq}, ${rows.length} rows): the export was replaced or cut.`);
    }
  }

  const verified = expect.verifiedHead;
  if (verified && verified.headSeq > 0) {
    const there = rows.find((r) => Number(r.seq) === verified.headSeq);
    if (!there) flag(verified.headSeq, `Row ${verified.headSeq}, the head the last passing verification saw, is not in the export.`);
    else if (there.hash !== verified.headHash) flag(verified.headSeq, `Row ${verified.headSeq} is not the row the last passing verification saw.`);
  }

  return { ok: problems.length === 0, rowsChecked: rows.length, headSeq, headHash, firstBadSeq: firstBad, problems };
}

export interface DatabaseChain {
  /** The head of the chain in the restored database. */
  headSeq: number;
  headHash: string;
  /** `seq` to `hash` for every row of the restored database up to the export's head. */
  hashes: Map<number, string>;
}

export interface DatabaseComparison {
  ok: boolean;
  /** Rows the restored database has after the export's head: fine, the log grew after the backup. */
  rowsAfterBackup: number;
  firstDifferentSeq: number | null;
  problems: string[];
}

/**
 * The part that answers F-03: the exported (off-site) copy against the restored database. Every row of the copy must be in the database
 * with the same hash; the database may have more rows after it, never fewer, never different. A consistent rewrite of the database
 * changes hashes, so it shows here even though the database's own verification passes.
 */
export function compareWithDatabase(anchor: ParsedAnchor, db: DatabaseChain): DatabaseComparison {
  const problems: string[] = [];
  let first: number | null = null;
  const flag = (seq: number, text: string) => {
    problems.push(text);
    if (first === null || seq < first) first = seq;
  };
  const exportedHead = anchor.rows.length ? Number(anchor.rows[anchor.rows.length - 1]!.seq) : 0;
  if (db.headSeq < exportedHead) flag(db.headSeq + 1, `The database ends at row ${db.headSeq} but the export has rows up to ${exportedHead}: rows were cut off the end.`);
  let different = 0;
  for (const row of anchor.rows) {
    const seq = Number(row.seq);
    const inDb = db.hashes.get(seq);
    if (inDb === undefined) {
      if (seq <= db.headSeq) flag(seq, `Row ${seq} is in the export but not in the database: it was removed.`);
    } else if (inDb !== row.hash) {
      different += 1;
      if (different <= 5) flag(seq, `Row ${seq} is different in the database: the log was rewritten.`);
      else if (first === null || seq < first) first = seq;
    }
  }
  if (different > 5) problems.push(`${different - 5} more rows differ.`);
  return { ok: problems.length === 0, rowsAfterBackup: Math.max(db.headSeq - exportedHead, 0), firstDifferentSeq: first, problems };
}
