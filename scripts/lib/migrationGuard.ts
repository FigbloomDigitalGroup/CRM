/**
 * Migration guard (FIG-1603, P2-20, section C). Pure functions, no database, no file access: the CLI is scripts/check-migrations.ts.
 *
 * Why: real data goes into the CRM. A migration that drops, renames, truncates or retypes something can destroy it, and Prisma writes such
 * statements without asking. The rule is expand and contract (docs/BACKUP_RESTORE.md section 10): add first, switch, drop in a later
 * release. A destructive statement is allowed only when the migration file carries an approval line with a name and a reason:
 *
 *   -- migration-guard: approved-by=Given reason=drop of the unused tickets tables, data exported first
 *
 * The scan ignores comments and the text of string literals, so a comment that says "no drop column here" does not trigger it.
 */

export type RuleId =
  | "drop-table"
  | "drop-column"
  | "drop-schema"
  | "truncate"
  | "delete-without-where"
  | "alter-column-type"
  | "rename";

export interface Finding {
  rule: RuleId;
  statement: string; // first 120 characters, whitespace collapsed
}

export interface Approval {
  approvedBy: string;
  reason: string;
}

export interface MigrationReport {
  findings: Finding[];
  approval: Approval | null;
  /** The marker is present but has no name or no reason. */
  approvalIncomplete: boolean;
}

const MARKER = /^[ \t]*--[ \t]*migration-guard:[ \t]*(.*)$/gim;

/** Remove `-- line` and `/* block *\/` comments and replace the inside of 'string literals' by spaces. Dollar-quoted bodies are kept: a DELETE in a DO block still counts. */
export function stripCommentsAndStrings(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; }
        else if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; }
        else i++;
      }
      out += " ";
    } else if (c === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      out += "''";
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export function parseApproval(sql: string): { approval: Approval | null; incomplete: boolean } {
  MARKER.lastIndex = 0;
  const m = MARKER.exec(sql);
  if (!m) return { approval: null, incomplete: false };
  const body = m[1];
  const by = /approved-by=([^\s]+(?:[ \t]+(?!reason=)[^\s=]+)*)/i.exec(body)?.[1]?.trim() ?? "";
  const reason = /reason=(.+)$/i.exec(body)?.[1]?.trim() ?? "";
  if (!by || reason.length < 8) return { approval: null, incomplete: true };
  return { approval: { approvedBy: by, reason }, incomplete: false };
}

const RULES: Array<{ rule: RuleId; test: (stmt: string) => boolean }> = [
  { rule: "drop-table", test: (s) => /\bdrop\s+table\b/i.test(s) },
  { rule: "drop-schema", test: (s) => /\bdrop\s+schema\b/i.test(s) },
  { rule: "drop-column", test: (s) => /\bdrop\s+(column\b|(?!constraint\b|index\b|policy\b|trigger\b|default\b|not\s+null\b|identity\b|expression\b)"?\w+)/i.test(s) && /\balter\s+table\b/i.test(s) },
  { rule: "truncate", test: (s) => /^\s*truncate\b/i.test(s) || /(^|[\s;])truncate\s+(table\s+)?["\w]/i.test(s) },
  { rule: "delete-without-where", test: (s) => /\bdelete\s+from\b/i.test(s) && !/\bwhere\b/i.test(s) },
  { rule: "alter-column-type", test: (s) => /\balter\s+column\b[^;]*\b(set\s+data\s+)?type\b/i.test(s) },
  { rule: "rename", test: (s) => /\balter\s+(table|index|sequence|type)\b[^;]*\brename\b/i.test(s) || /\balter\s+table\b[^;]*\brename\s+(column|to|constraint)\b/i.test(s) },
];

export function scanMigration(sql: string): MigrationReport {
  const clean = stripCommentsAndStrings(sql);
  const findings: Finding[] = [];
  for (const raw of clean.split(";")) {
    const stmt = raw.replace(/\s+/g, " ").trim();
    if (!stmt) continue;
    // A trigger that only fires BEFORE TRUNCATE is protection, not a truncate.
    const isTriggerDef = /^create\s+(or\s+replace\s+)?trigger\b/i.test(stmt);
    for (const { rule, test } of RULES) {
      if (isTriggerDef && rule === "truncate") continue;
      if (test(stmt)) findings.push({ rule, statement: stmt.slice(0, 120) });
    }
  }
  const { approval, incomplete } = parseApproval(sql);
  return { findings, approval, approvalIncomplete: incomplete };
}

export interface GuardVerdict {
  name: string;
  ok: boolean;
  problems: string[];
}

/**
 * Decide for one migration. `baseline` holds migrations that were already applied everywhere before the guard existed (grandfathered by name).
 */
export function judge(name: string, sql: string, baseline: ReadonlySet<string>): GuardVerdict {
  const report = scanMigration(sql);
  const problems: string[] = [];
  if (report.findings.length > 0 && !baseline.has(name) && !report.approval) {
    for (const f of report.findings) problems.push(`${f.rule}: ${f.statement}`);
    problems.push(
      report.approvalIncomplete
        ? "the approval line is incomplete: it needs approved-by=<name> and reason=<at least a short sentence>"
        : "add `-- migration-guard: approved-by=<name> reason=<why>` only with Given's written approval, or rewrite as expand and contract",
    );
  }
  return { name, ok: problems.length === 0, problems };
}
