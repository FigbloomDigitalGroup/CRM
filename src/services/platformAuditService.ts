import { stringifyCsv } from "../lib/csv";
import { ValidationError } from "../auth/errors";
import { getPlatformDb } from "../db/platformClient";

/**
 * The platform audit log (FIG-1138, B6.06, design PL8): every platform action
 * is one row in `platform_audit_events`, which nothing can edit.
 *
 *   append-only      the table has no update or delete path: the platform role has
 *                    only SELECT and INSERT on it, and a trigger refuses UPDATE,
 *                    DELETE and TRUNCATE for every role.
 *   tamper-evident   a trigger gives each row `seq` (no gaps) and chains it to the
 *                    one before: `hash` = SHA-256 of the row's fields and
 *                    `prev_hash`. Change, remove or insert a row and the chain
 *                    breaks. `verifyAuditChain` recomputes it, and remembers the
 *                    head it saw so rows cut off the end are noticed next time.
 *
 * Entries hold who, what, which organisation, the reason and small facts about
 * the action. Never a customer name, a deal value, a payment or any free text of
 * the organisation's: `metadata` is limited to flat, short, non-sensitive values.
 */

/** Anything that can run raw SQL: the platform client, the admin client, or a transaction on either. */
export interface RawSqlClient {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

export interface PlatformAuditEntry {
  /** The platform admin; null for the system (a scheduled sweep). */
  actorIdentityId: string | null;
  /** Who, readable later even if the identity is gone (their email, or "system"). */
  actorLabel: string;
  /** For example `organization.suspended`. */
  action: string;
  targetType: string;
  targetId?: string | null;
  organizationId?: string | null;
  organizationSlug?: string | null;
  reason?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
  requestId?: string | null;
}

const MAX_METADATA_BYTES = 2048;
const FORBIDDEN_METADATA_KEY = /(value|amount|price|cost|margin|payment|revenue|password|secret|token|phone)/i;

function checkMetadata(metadata: PlatformAuditEntry["metadata"]): Record<string, string | number | boolean | null> {
  const clean = metadata ?? {};
  for (const [key, value] of Object.entries(clean)) {
    if (FORBIDDEN_METADATA_KEY.test(key)) {
      throw new Error(`Audit metadata key "${key}" is not allowed: the platform log holds no values, payments or secrets.`);
    }
    if (value !== null && typeof value === "object") throw new Error(`Audit metadata "${key}" must be a plain value.`);
  }
  if (Buffer.byteLength(JSON.stringify(clean)) > MAX_METADATA_BYTES) throw new Error("Audit metadata is too large.");
  return clean;
}

/**
 * Appends one entry. Pass a transaction client when the entry must commit or fail together with the change it records.
 * The database chains it; the values passed for `seq`, `prev_hash` and `hash` are placeholders the trigger replaces.
 */
export async function recordPlatformAudit(client: RawSqlClient, entry: PlatformAuditEntry): Promise<void> {
  const metadata = JSON.stringify(checkMetadata(entry.metadata));
  await client.$executeRaw`
    INSERT INTO platform_audit_events
      (seq, actor_identity_id, actor_label, action, target_type, target_id, organization_id, organization_slug,
       reason, metadata, request_id, prev_hash, hash)
    VALUES
      (0, ${entry.actorIdentityId}, ${entry.actorLabel}, ${entry.action}, ${entry.targetType}, ${entry.targetId ?? null},
       ${entry.organizationId ?? null}, ${entry.organizationSlug ?? null}, ${entry.reason ?? null},
       ${metadata}::jsonb, ${entry.requestId ?? null}, '', '')`;
}

// ---------------------------------------------------------------------------
// Query and export
// ---------------------------------------------------------------------------

export interface AuditQuery {
  action?: string;
  organizationId?: string;
  actorIdentityId?: string;
  from?: Date;
  to?: Date;
  /** Rows older than this `seq` (the previous page's `nextCursor`). */
  before?: number;
  limit?: number;
}

export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_MAX_PAGE_SIZE = 200;
export const AUDIT_EXPORT_MAX_ROWS = 10_000;

interface AuditRow {
  seq: bigint;
  id: string;
  occurred_at: Date;
  actor_identity_id: string | null;
  actor_label: string;
  action: string;
  target_type: string;
  target_id: string | null;
  organization_id: string | null;
  organization_slug: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  request_id: string | null;
  prev_hash: string;
  hash: string;
}

export interface AuditEvent {
  seq: number;
  id: string;
  occurredAt: string;
  actorIdentityId: string | null;
  actorLabel: string;
  action: string;
  targetType: string;
  targetId: string | null;
  organizationId: string | null;
  organizationSlug: string | null;
  reason: string | null;
  metadata: Record<string, unknown>;
  requestId: string | null;
  prevHash: string;
  hash: string;
}

function present(row: AuditRow): AuditEvent {
  return {
    seq: Number(row.seq),
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    actorIdentityId: row.actor_identity_id,
    actorLabel: row.actor_label,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    organizationId: row.organization_id,
    organizationSlug: row.organization_slug,
    reason: row.reason,
    metadata: row.metadata,
    requestId: row.request_id,
    prevHash: row.prev_hash,
    hash: row.hash,
  };
}

async function selectEvents(query: AuditQuery, limit: number): Promise<AuditRow[]> {
  const db = getPlatformDb();
  // Parameters are optional filters: `IS NULL OR` keeps one static, injection-proof statement.
  return db.$queryRaw<AuditRow[]>`
    SELECT seq, id, occurred_at, actor_identity_id, actor_label, action, target_type, target_id, organization_id,
           organization_slug, reason, metadata, request_id, prev_hash, hash
    FROM platform_audit_events
    WHERE (${query.action ?? null}::text IS NULL OR action = ${query.action ?? null} OR action LIKE ${(query.action ?? "") + ".%"})
      AND (${query.organizationId ?? null}::text IS NULL OR organization_id = ${query.organizationId ?? null})
      AND (${query.actorIdentityId ?? null}::text IS NULL OR actor_identity_id = ${query.actorIdentityId ?? null})
      AND (${query.from ?? null}::timestamp IS NULL OR occurred_at >= ${query.from ?? null})
      AND (${query.to ?? null}::timestamp IS NULL OR occurred_at <= ${query.to ?? null})
      AND (${query.before ?? null}::bigint IS NULL OR seq < ${query.before ?? null})
    ORDER BY seq DESC
    LIMIT ${limit}`;
}

/** Newest first. `nextCursor` is the `seq` to pass as `before` for the next page, or null at the end. */
export async function listAuditEvents(query: AuditQuery = {}): Promise<{ items: AuditEvent[]; nextCursor: number | null }> {
  const limit = Math.min(Math.max(Math.floor(query.limit ?? AUDIT_PAGE_SIZE), 1), AUDIT_MAX_PAGE_SIZE);
  const rows = await selectEvents(query, limit + 1);
  const page = rows.slice(0, limit).map(present);
  return { items: page, nextCursor: rows.length > limit ? page[page.length - 1]!.seq : null };
}

/** The same filters as a CSV (formula-safe), oldest first, capped at {@link AUDIT_EXPORT_MAX_ROWS}. */
export async function exportAuditCsv(query: AuditQuery = {}): Promise<{ csv: string; rows: number; truncated: boolean }> {
  const rows = await selectEvents({ ...query, before: undefined }, AUDIT_EXPORT_MAX_ROWS + 1);
  const truncated = rows.length > AUDIT_EXPORT_MAX_ROWS;
  const events = rows.slice(0, AUDIT_EXPORT_MAX_ROWS).map(present).reverse();
  const csv = stringifyCsv(
    events.map((e) => ({
      seq: e.seq,
      occurred_at: e.occurredAt,
      actor: e.actorLabel,
      action: e.action,
      target_type: e.targetType,
      target_id: e.targetId ?? "",
      organisation: e.organizationSlug ?? "",
      reason: e.reason ?? "",
      metadata: JSON.stringify(e.metadata),
      request_id: e.requestId ?? "",
      hash: e.hash,
    })),
    { header: true },
  );
  return { csv, rows: events.length, truncated };
}

export function parseAuditDate(value: string | undefined, name: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ValidationError(`${name} must be a date.`, [{ path: name, message: "Use an ISO date." }]);
  return date;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface VerificationResult {
  ok: boolean;
  rowsChecked: number;
  headSeq: number;
  headHash: string;
  /** The first row where the chain does not hold, or the first missing one. */
  firstBadSeq: number | null;
  problem: string | null;
  runId: string;
}

interface ChainRow {
  seq: bigint;
  hash: string;
  prev_hash: string;
  expected_hash: string;
  expected_prev: string | null;
  prev_seq: bigint | null;
}

/**
 * Recomputes the whole chain (the same SQL function the insert trigger uses) and checks, in order:
 *   1. every row's `hash` matches its content (an edited row),
 *   2. every row's `prev_hash` is the previous row's `hash` and `seq` has no gap (a removed or inserted row),
 *   3. the head recorded by the last *passing* run is still there with the same hash (rows cut off the end). A failed run never
 *    moves the trusted head, so a tampered log cannot become the baseline.
 * The result is stored (append-only) so the next run can do step 3 and the console can show the last run.
 */
export async function verifyAuditChain(trigger: "MANUAL" | "SCHEDULED" = "MANUAL"): Promise<VerificationResult> {
  const db = getPlatformDb();
  const rows = await db.$queryRaw<ChainRow[]>`
    SELECT e.seq, e.hash, e.prev_hash,
           platform_audit_row_hash(e.prev_hash, e.seq, e.id, e.occurred_at, e.actor_identity_id, e.actor_label, e.action,
             e.target_type, e.target_id, e.organization_id, e.organization_slug, e.reason, e.metadata, e.request_id) AS expected_hash,
           lag(e.hash) OVER (ORDER BY e.seq) AS expected_prev,
           lag(e.seq) OVER (ORDER BY e.seq) AS prev_seq
    FROM platform_audit_events e
    ORDER BY e.seq`;

  let firstBad: number | null = null;
  let problem: string | null = null;
  const flag = (seq: number, text: string) => {
    if (firstBad === null) {
      firstBad = seq;
      problem = text;
    }
  };

  rows.forEach((r, index) => {
    const seq = Number(r.seq);
    if (r.hash !== r.expected_hash) flag(seq, `Row ${seq} does not match its hash: it was changed.`);
    if (index === 0) {
      if (r.prev_hash !== "GENESIS") flag(seq, `Row ${seq} should start the log but does not: earlier rows were removed.`);
    } else {
      if (r.prev_seq !== null && Number(r.prev_seq) + 1 !== seq) flag(Number(r.prev_seq) + 1, `Rows are missing after ${Number(r.prev_seq)}: they were removed.`);
      if (r.prev_hash !== r.expected_prev) flag(seq, `Row ${seq} does not follow the row before it: the chain was broken.`);
    }
  });

  const head = rows[rows.length - 1];
  const headSeq = head ? Number(head.seq) : 0;
  const headHash = head?.hash ?? "GENESIS";

  const previous = await db.$queryRaw<{ head_seq: bigint; head_hash: string }[]>`
    SELECT head_seq, head_hash FROM platform_audit_verifications WHERE ok ORDER BY run_at DESC, id DESC LIMIT 1`;
  const last = previous[0];
  if (last && last.head_seq > 0n) {
    const lastSeq = Number(last.head_seq);
    const there = rows.find((r) => Number(r.seq) === lastSeq);
    if (!there) flag(lastSeq, `Row ${lastSeq}, the end of the log at the last check, is gone: rows were cut off the end.`);
    else if (there.hash !== last.head_hash) flag(lastSeq, `Row ${lastSeq} is not the row seen at the last check: it was replaced.`);
  }

  const ok = firstBad === null;
  const saved = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO platform_audit_verifications (ok, rows_checked, head_seq, head_hash, first_bad_seq, problem, "trigger")
    VALUES (${ok}, ${rows.length}, ${headSeq}, ${headHash}, ${firstBad}, ${problem}, ${trigger})
    RETURNING id`;
  return { ok, rowsChecked: rows.length, headSeq, headHash, firstBadSeq: firstBad, problem, runId: saved[0]!.id };
}

export async function lastVerification() {
  const rows = await getPlatformDb().$queryRaw<
    { id: string; run_at: Date; ok: boolean; rows_checked: number; head_seq: bigint; first_bad_seq: bigint | null; problem: string | null; trigger: string }[]
  >`SELECT id, run_at, ok, rows_checked, head_seq, first_bad_seq, problem, "trigger" FROM platform_audit_verifications ORDER BY run_at DESC, id DESC LIMIT 1`;
  const r = rows[0];
  return r
    ? { id: r.id, runAt: r.run_at.toISOString(), ok: r.ok, rowsChecked: r.rows_checked, headSeq: Number(r.head_seq), firstBadSeq: r.first_bad_seq === null ? null : Number(r.first_bad_seq), problem: r.problem, trigger: r.trigger }
    : null;
}
