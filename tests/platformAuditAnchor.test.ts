import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { getPlatformDb } from "../src/db/platformClient";
import { recordPlatformAudit } from "../src/services/platformAuditService";
import {
  AnchorFormatError,
  GENESIS,
  checkAnchor,
  compareWithDatabase,
  parseAnchor,
  parseHeadFile,
  parseVerifiedHead,
  rowHash,
  type AnchorRow,
  type DatabaseChain,
  type ParsedAnchor,
} from "../src/services/platformAuditAnchorService";

/**
 * FIG-1566 (F-03): the platform audit export and chain head kept with the backups, and the restore check that compares them.
 * The first half needs no database: it builds chains with the same recipe as the database trigger. The second half uses the real
 * trigger and the real export SQL (ops/backup/audit-export.sql), which is what proves the two recipes agree.
 */

function makeRow(prev: string, seq: number, over: Partial<AnchorRow> = {}): AnchorRow {
  const row: AnchorRow = {
    kind: "row",
    seq: String(seq),
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    occurred_text: `2026-11-1${seq % 10}T08:00:00.${String(seq * 7).padStart(3, "0")}`,
    actor_identity_id: seq % 2 ? null : "11111111-1111-4111-8111-111111111111",
    actor_label: seq % 2 ? "system" : "admin@figbloom.test",
    action: "organization.suspended",
    target_type: "Organization",
    target_id: seq % 3 ? `org-${seq}` : null,
    organization_id: null,
    organization_slug: seq % 3 ? `slug-${seq}` : null,
    reason: seq % 2 ? null : "a reason, with “unicode” and a comma",
    metadata_text: '{"a": 1, "b": "x"}',
    request_id: null,
    prev_hash: prev,
    hash: "",
    ...over,
  };
  row.hash = rowHash(row);
  return row;
}

function makeChain(n: number): AnchorRow[] {
  const rows: AnchorRow[] = [];
  let prev = GENESIS;
  for (let i = 1; i <= n; i++) {
    const row = makeRow(prev, i);
    rows.push(row);
    prev = row.hash;
  }
  return rows;
}

function headOf(rows: AnchorRow[]) {
  const last = rows[rows.length - 1];
  return { rows: rows.length, headSeq: last ? Number(last.seq) : 0, headHash: last?.hash ?? GENESIS };
}

function toFile(rows: AnchorRow[], head = headOf(rows)): string {
  const lines = rows.map((r) => JSON.stringify(r));
  lines.push(JSON.stringify({ kind: "head", rows: String(head.rows), head_seq: String(head.headSeq), head_hash: head.headHash }));
  return lines.join("\n") + "\n";
}

function headLine(rows: AnchorRow[]): string {
  const h = headOf(rows);
  return JSON.stringify({ kind: "head", rows: String(h.rows), head_seq: String(h.headSeq), head_hash: h.headHash });
}

/** Rebuilds a chain from row `from` on with a change applied, so every later hash is consistent again (the F-03 attack). */
function rewriteFrom(rows: AnchorRow[], from: number, change: Partial<AnchorRow>): AnchorRow[] {
  const out: AnchorRow[] = [];
  let prev = GENESIS;
  for (const r of rows) {
    const seq = Number(r.seq);
    const next = makeRow(prev, seq, { ...r, ...(seq === from ? change : {}), prev_hash: prev, hash: "" });
    out.push(next);
    prev = next.hash;
  }
  return out;
}

describe("the export format and the check on a clean chain", () => {
  it("passes a clean chain and reports its head", () => {
    const rows = makeChain(6);
    const parsed = parseAnchor(toFile(rows));
    const result = checkAnchor(parsed, { storedHead: parseHeadFile(headLine(rows)) });
    expect(result).toMatchObject({ ok: true, rowsChecked: 6, headSeq: 6, headHash: rows[5]!.hash, firstBadSeq: null, problems: [] });
  });

  it("recomputes the same hash for rows with and without the nullable fields", () => {
    const rows = makeChain(4);
    expect(new Set(rows.map((r) => r.target_id === null)).size).toBe(2);
    expect(checkAnchor(parseAnchor(toFile(rows))).ok).toBe(true);
  });

  it("checks the verified head the database recorded, when the export has that row", () => {
    const rows = makeChain(5);
    const parsed = parseAnchor(toFile(rows));
    expect(checkAnchor(parsed, { verifiedHead: { headSeq: 3, headHash: rows[2]!.hash, runAt: "2026-11-10T00:00:00.000" } }).ok).toBe(true);
    const wrong = checkAnchor(parsed, { verifiedHead: { headSeq: 3, headHash: "a".repeat(64), runAt: "2026-11-10T00:00:00.000" } });
    expect(wrong.ok).toBe(false);
    expect(wrong.problems.join(" ")).toMatch(/Row 3 is not the row the last passing verification saw/);
    const missing = checkAnchor(parsed, { verifiedHead: { headSeq: 9, headHash: "b".repeat(64), runAt: "2026-11-10T00:00:00.000" } });
    expect(missing.ok).toBe(false);
  });
});

describe("a tampered row", () => {
  it("is found at the row that was changed", () => {
    const rows = makeChain(5);
    rows[2] = { ...rows[2]!, reason: "forged reason" };
    const result = checkAnchor(parseAnchor(toFile(rows, headOf(makeChain(5)))));
    expect(result.ok).toBe(false);
    expect(result.firstBadSeq).toBe(3);
    expect(result.problems.join(" ")).toMatch(/Row 3 does not match its hash: it was changed/);
  });

  it("is found even when the row's hash was changed to fit: the next row no longer follows it", () => {
    const rows = makeChain(5);
    const forged = { ...rows[1]!, reason: "forged" };
    forged.hash = rowHash(forged);
    rows[1] = forged;
    const result = checkAnchor(parseAnchor(toFile(rows)));
    expect(result.ok).toBe(false);
    expect(result.firstBadSeq).toBe(3);
    expect(result.problems.join(" ")).toMatch(/Row 3 does not follow the row before it/);
  });

  it("is found when the whole tail is rewritten consistently, but only against the stored head (the point of F-03)", () => {
    const original = makeChain(6);
    const storedHead = parseHeadFile(headLine(original));
    const rewritten = rewriteFrom(original, 3, { reason: "history that never happened" });
    const file = parseAnchor(toFile(rewritten));
    // On its own the rewritten file is a perfectly valid chain, exactly as the database's own verification would see it.
    expect(checkAnchor(file).ok).toBe(true);
    const against = checkAnchor(file, { storedHead });
    expect(against.ok).toBe(false);
    expect(against.problems.join(" ")).toMatch(/stored head/);
  });

  it("is found when a row in the middle is removed", () => {
    const rows = makeChain(5);
    const cut = rows.filter((r) => r.seq !== "3");
    const result = checkAnchor(parseAnchor(toFile(cut, headOf(rows))));
    expect(result.ok).toBe(false);
    expect(result.firstBadSeq).toBe(3);
    expect(result.problems.join(" ")).toMatch(/Rows are missing after 2/);
  });

  it("is found when the first rows are removed", () => {
    const rows = makeChain(5).slice(2);
    const result = checkAnchor(parseAnchor(toFile(rows)));
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/Rows are missing after 0|earlier rows were removed/);
  });

  it("is found when two rows are swapped", () => {
    const rows = makeChain(5);
    [rows[1], rows[2]] = [rows[2]!, rows[1]!];
    expect(checkAnchor(parseAnchor(toFile(rows))).ok).toBe(false);
  });
});

describe("a truncated tail", () => {
  it("is found when the head line still says how many rows there should be", () => {
    const rows = makeChain(6);
    const result = checkAnchor(parseAnchor(toFile(rows.slice(0, 4), headOf(rows))));
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/counts 6 rows but the file holds 4/);
  });

  it("is found when the head line was cut off too", () => {
    const rows = makeChain(6);
    const text = toFile(rows.slice(0, 4)).split("\n").slice(0, 4).join("\n") + "\n";
    const result = checkAnchor(parseAnchor(text));
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/no head line: it was cut off/);
  });

  it("is found when the head line was rewritten to fit, by the head file kept apart", () => {
    const rows = makeChain(6);
    const storedHead = parseHeadFile(headLine(rows));
    const cutAndFixed = checkAnchor(parseAnchor(toFile(rows.slice(0, 4))), { storedHead });
    expect(cutAndFixed.ok).toBe(false);
    expect(cutAndFixed.problems.join(" ")).toMatch(/stored head \(seq 6, 6 rows\)/);
  });

  it("is found when the line cut in half is not valid JSON", () => {
    const text = toFile(makeChain(3));
    expect(() => parseAnchor(text.slice(0, text.length - 40))).toThrow(AnchorFormatError);
  });
});

describe("an empty log", () => {
  it("is a valid anchor: no rows, head GENESIS", () => {
    const parsed = parseAnchor(toFile([]));
    const result = checkAnchor(parsed, { storedHead: parseHeadFile(headLine([])) });
    expect(result).toMatchObject({ ok: true, rowsChecked: 0, headSeq: 0, headHash: GENESIS });
  });

  it("is not accepted when there is no head line at all (an empty file is a failed export, not an empty log)", () => {
    const result = checkAnchor(parseAnchor(""));
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toMatch(/no head line/);
  });

  it("is not accepted when the stored head says there were rows", () => {
    const stored = parseHeadFile(headLine(makeChain(3)));
    const result = checkAnchor(parseAnchor(toFile([])), { storedHead: stored });
    expect(result.ok).toBe(false);
  });
});

describe("reading the files", () => {
  it("refuses lines after the head line, unknown kinds and missing fields", () => {
    const rows = makeChain(2);
    expect(() => parseAnchor(toFile(rows) + JSON.stringify(rows[0]) + "\n")).toThrow(/after the head line/);
    expect(() => parseAnchor('{"kind":"other"}\n')).toThrow(/unknown kind/);
    const noHash: Partial<AnchorRow> = { ...rows[0]! };
    delete noHash.hash;
    expect(() => parseAnchor(JSON.stringify(noHash) + "\n")).toThrow(/"hash" is missing/);
    expect(() => parseAnchor("not json\n")).toThrow(/not valid JSON/);
  });

  it("reads the head file and the verified head file", () => {
    const rows = makeChain(2);
    expect(parseHeadFile(headLine(rows) + "\n")).toEqual(headOf(rows));
    expect(() => parseHeadFile("")).toThrow(AnchorFormatError);
    expect(() => parseHeadFile(headLine(rows) + "\n" + headLine(rows))).toThrow(AnchorFormatError);
    expect(parseVerifiedHead("")).toBeNull();
    expect(parseVerifiedHead(JSON.stringify({ kind: "verified_head", head_seq: "4", head_hash: "c".repeat(64), run_at: "2026-11-10T00:00:00.000" }))).toMatchObject({ headSeq: 4 });
  });
});

describe("comparing the export with a restored database", () => {
  function dbOf(rows: AnchorRow[], extra = 0): DatabaseChain {
    const hashes = new Map(rows.map((r) => [Number(r.seq), r.hash] as const));
    return { headSeq: rows.length + extra, headHash: rows[rows.length - 1]?.hash ?? GENESIS, hashes };
  }
  const anchorOf = (rows: AnchorRow[]): ParsedAnchor => parseAnchor(toFile(rows));

  it("agrees with an identical database, and with one that has newer rows", () => {
    const rows = makeChain(5);
    expect(compareWithDatabase(anchorOf(rows), dbOf(rows))).toMatchObject({ ok: true, rowsAfterBackup: 0 });
    expect(compareWithDatabase(anchorOf(rows), dbOf(rows, 2))).toMatchObject({ ok: true, rowsAfterBackup: 2 });
  });

  it("finds a consistently rewritten database, which the database's own verification would pass", () => {
    const rows = makeChain(6);
    const rewritten = rewriteFrom(rows, 4, { reason: "rewritten" });
    expect(checkAnchor(anchorOf(rewritten)).ok).toBe(true);
    const result = compareWithDatabase(anchorOf(rows), dbOf(rewritten));
    expect(result.ok).toBe(false);
    expect(result.firstDifferentSeq).toBe(4);
    expect(result.problems[0]).toMatch(/Row 4 is different in the database: the log was rewritten/);
  });

  it("finds rows removed from the end or the middle of the database", () => {
    const rows = makeChain(5);
    const short = compareWithDatabase(anchorOf(rows), dbOf(rows.slice(0, 3)));
    expect(short.ok).toBe(false);
    expect(short.problems.join(" ")).toMatch(/cut off the end/);
    const hashes = new Map(rows.map((r) => [Number(r.seq), r.hash] as const));
    hashes.delete(2);
    const gap = compareWithDatabase(anchorOf(rows), { headSeq: 5, headHash: rows[4]!.hash, hashes });
    expect(gap.ok).toBe(false);
    expect(gap.problems.join(" ")).toMatch(/Row 2 is in the export but not in the database/);
  });

  it("agrees when both are empty", () => {
    expect(compareWithDatabase(anchorOf([]), dbOf([])).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Against the real trigger and the real export SQL
// ---------------------------------------------------------------------------

const EXPORT_SQL = readFileSync(join(__dirname, "..", "ops", "backup", "audit-export.sql"), "utf8");
const VERIFIED_SQL = readFileSync(join(__dirname, "..", "ops", "backup", "audit-verified-head.sql"), "utf8");

async function exportFromDatabase(): Promise<string> {
  const rows = await adminDb.$queryRawUnsafe<{ line: string }[]>(EXPORT_SQL);
  return rows.map((r) => r.line).join("\n") + "\n";
}

async function databaseChain(): Promise<DatabaseChain> {
  const rows = await adminDb.$queryRaw<{ seq: string; hash: string }[]>`SELECT e.seq::text AS seq, e.hash FROM platform_audit_events e ORDER BY e.seq`;
  return {
    headSeq: rows.length ? Number(rows[rows.length - 1]!.seq) : 0,
    headHash: rows[rows.length - 1]?.hash ?? GENESIS,
    hashes: new Map(rows.map((r) => [Number(r.seq), r.hash] as const)),
  };
}

async function withTriggerOff<T>(trigger: string, change: () => Promise<T>): Promise<T> {
  await adminDb.$executeRawUnsafe(`ALTER TABLE platform_audit_events DISABLE TRIGGER ${trigger}`);
  try {
    return await change();
  } finally {
    await adminDb.$executeRawUnsafe(`ALTER TABLE platform_audit_events ENABLE TRIGGER ${trigger}`);
  }
}

afterAll(async () => {
  await getPlatformDb().$disconnect();
});

describe("the export from the real database", () => {
  it("is recomputed to the same hashes by the restore check, for every row including awkward text", async () => {
    const platform = getPlatformDb();
    await recordPlatformAudit(platform, { actorIdentityId: null, actorLabel: "anchor-test", action: "anchor.plain", targetType: "Test" });
    await recordPlatformAudit(platform, {
      actorIdentityId: null,
      actorLabel: "anchor-test “ünï” ☃",
      action: "anchor.awkward",
      targetType: "Test",
      targetId: "t-1",
      organizationSlug: "acme",
      reason: 'a reason with a comma, a "quote", a \\ backslash and a\nnewline',
      metadata: { zeta: 1, alpha: "x", mid: true, nothing: null, text: "tab\there" },
      requestId: "req-1",
    });
    const text = await exportFromDatabase();
    const parsed = parseAnchor(text);
    expect(parsed.rows.length).toBeGreaterThanOrEqual(2);
    const result = checkAnchor(parsed);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(parsed.head).toMatchObject({ rows: parsed.rows.length, headSeq: result.headSeq, headHash: result.headHash });
    expect(compareWithDatabase(parsed, await databaseChain()).ok).toBe(true);
    // The verified-head query returns at most one valid line.
    const verified = await adminDb.$queryRawUnsafe<{ line: string }[]>(VERIFIED_SQL);
    expect(verified.length).toBeLessThanOrEqual(1);
    if (verified[0]) expect(parseVerifiedHead(verified[0].line)).not.toBeNull();
  });

  it("shows a consistent rewrite of the database against an earlier export, which the chain alone cannot", async () => {
    const platform = getPlatformDb();
    await recordPlatformAudit(platform, { actorIdentityId: null, actorLabel: "anchor-test", action: "anchor.rewrite", targetType: "Test", reason: "original" });
    const before = parseAnchor(await exportFromDatabase());
    const lastSeq = Number(before.rows[before.rows.length - 1]!.seq);
    try {
      // The attack: switch the trigger off, change the newest row and recompute its hash with the database's own function.
      await withTriggerOff("platform_audit_events_no_update", () =>
        adminDb.$executeRawUnsafe(`
          UPDATE platform_audit_events e SET reason = 'rewritten', hash = platform_audit_row_hash(
            e.prev_hash, e.seq, e.id, e.occurred_at, e.actor_identity_id, e.actor_label, e.action, e.target_type, e.target_id,
            e.organization_id, e.organization_slug, 'rewritten', e.metadata, e.request_id)
          WHERE e.seq = ${lastSeq}::bigint`),
      );
      const after = parseAnchor(await exportFromDatabase());
      expect(checkAnchor(after).ok).toBe(true); // the rewritten log is a valid chain on its own
      const result = checkAnchor(after, { storedHead: parseHeadFile(headLine2(before)) });
      expect(result.ok).toBe(false);
      const comparison = compareWithDatabase(before, await databaseChain());
      expect(comparison.ok).toBe(false);
      expect(comparison.firstDifferentSeq).toBe(lastSeq);
    } finally {
      await withTriggerOff("platform_audit_events_no_update", () =>
        adminDb.$executeRawUnsafe(`
          UPDATE platform_audit_events e SET reason = 'original', hash = platform_audit_row_hash(
            e.prev_hash, e.seq, e.id, e.occurred_at, e.actor_identity_id, e.actor_label, e.action, e.target_type, e.target_id,
            e.organization_id, e.organization_slug, 'original', e.metadata, e.request_id)
          WHERE e.seq = ${lastSeq}::bigint`),
      );
    }
    expect(compareWithDatabase(before, await databaseChain()).ok).toBe(true);
  });
});

function headLine2(anchor: ParsedAnchor): string {
  const h = anchor.head!;
  return JSON.stringify({ kind: "head", rows: String(h.rows), head_seq: String(h.headSeq), head_hash: h.headHash });
}

