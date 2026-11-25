/** Pure part of the post-migration verification (FIG-1603, P2-20 section C.5). The CLI is scripts/verify-migration.ts. */
import { APP_ROLE_CLOSED_TABLES, APP_ROLE_COLUMN_LIMITED_TABLES } from "./appRoleRestrictedTables";

export interface TableState {
  name: string;
  rows: number;
  hasOrganizationId: boolean;
  rlsEnabled: boolean;
  rlsForced: boolean;
  policies: number;
  appCanSelect: boolean;
}

/** UC-F3 (S-4): what the app role can do with the credential tables, read from the owner connection. Names only. */
export interface CredentialGrantState {
  /** Credential columns of users the app role can SELECT (must be none). */
  credentialColumnsReadable: string[];
  /** Non-secret columns of users the app role cannot SELECT (must be none: the app reads them). */
  safeColumnsMissing: string[];
  /** Write privileges the app role holds on users (must be none). */
  usersWritePrivileges: string[];
  /** Privileges the app role holds on the closed credential tables, as "table: PRIVILEGE" (must be none). */
  closedTablePrivileges: string[];
  /** Columns of users that are in neither list: a new column has to be classified (must be none). */
  unclassifiedColumns: string[];
}

export interface VerifyInput {
  tables: TableState[];
  /** undefined when the app role does not exist. */
  credentialGrants?: CredentialGrantState;
  /** Row counts taken before the migration (table name to rows), when a snapshot was given. */
  before?: Record<string, number>;
  appRoleExists: boolean;
  /** UC-F7: tables the app role is deliberately kept out of (default: the list in appRoleRestrictedTables.ts). */
  closedTables?: readonly string[];
  /** UC-F7: with a snapshot, require every count to be EQUAL (a like-for-like restore), not just "not fewer". */
  exact?: boolean;
  /** UC-F7: the caller states that no snapshot applies (a plain health check, not a migration gate); the snapshot check is skipped, not passed. */
  noSnapshot?: boolean;
  /** undefined when no app connection was given. */
  appRead?: { connected: boolean; ownOrgVisible: boolean; noOrgSeesRows: number; detail?: string };
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  /** The check was not applicable and was left out on purpose (it counts as ok but is printed as SKIP). */
  skipped?: boolean;
}

export interface VerifyReport {
  ok: boolean;
  checks: Check[];
  totalRows: number;
}

const list = (xs: string[]) => (xs.length > 6 ? `${xs.slice(0, 6).join(", ")} and ${xs.length - 6} more` : xs.join(", "));

export function evaluate(input: VerifyInput): VerifyReport {
  const checks: Check[] = [];
  const tenant = input.tables.filter((t) => t.hasOrganizationId);

  const noRls = tenant.filter((t) => !t.rlsEnabled || !t.rlsForced).map((t) => t.name);
  checks.push({
    name: "RLS on for every tenant table",
    ok: noRls.length === 0,
    detail: noRls.length ? `missing or not forced: ${list(noRls)}` : `${tenant.length} tenant tables, all enabled and forced`,
  });

  const noPolicy = tenant.filter((t) => t.policies === 0).map((t) => t.name);
  checks.push({
    name: "Every tenant table has a policy",
    ok: noPolicy.length === 0,
    detail: noPolicy.length ? `no policy: ${list(noPolicy)}` : "all have at least one",
  });

  checks.push({
    name: "App role exists",
    ok: input.appRoleExists,
    detail: input.appRoleExists ? "figbloom_app found" : "figbloom_app is missing: run npm run db:bootstrap-role and npm run db:grant-role",
  });
  // UC-F7: the closed set is explicit. Every other table must be readable; every closed table that exists must NOT be.
  const closed = new Set<string>(input.closedTables ?? APP_ROLE_CLOSED_TABLES);
  const columnLimited = new Set<string>(APP_ROLE_COLUMN_LIMITED_TABLES);
  const noGrant = input.tables.filter((t) => !t.appCanSelect && !closed.has(t.name) && !columnLimited.has(t.name)).map((t) => t.name);
  checks.push({
    name: "App role can read every table it should",
    ok: input.appRoleExists && noGrant.length === 0,
    detail: noGrant.length
      ? `no SELECT on: ${list(noGrant)} (run npm run db:grant-role)`
      : `SELECT granted on every table except the ${input.tables.filter((t) => closed.has(t.name) || columnLimited.has(t.name)).length} deliberately closed or column-limited`,
  });
  const openButClosed = input.tables.filter((t) => closed.has(t.name) && t.appCanSelect).map((t) => t.name);
  checks.push({
    name: "App role cannot read the closed tables",
    ok: input.appRoleExists && openButClosed.length === 0,
    detail: openButClosed.length
      ? `readable but must be closed: ${list(openButClosed)} (run npm run db:grant-role)`
      : `${input.tables.filter((t) => closed.has(t.name)).length} closed tables are closed`,
  });

  if (input.credentialGrants) {
    const g = input.credentialGrants;
    const problems = [
      ...g.credentialColumnsReadable.map((c) => `app role can read users.${c}`),
      ...g.usersWritePrivileges.map((p) => `app role has ${p} on users`),
      ...g.closedTablePrivileges.map((p) => `app role has ${p}`),
      ...g.safeColumnsMissing.map((c) => `app role cannot read users.${c}`),
      ...g.unclassifiedColumns.map((c) => `users.${c} is not classified in scripts/lib/appRoleCredentialGrants.ts`),
    ];
    checks.push({
      name: "App role cannot read credentials (UC-F3)",
      ok: problems.length === 0,
      detail: problems.length ? `${list(problems)} (run npm run db:grant-role)` : "no password hash, lockout field or reset token readable; users is column-limited and read-only",
    });
  }

  if (input.before) {
    const now = new Map(input.tables.map((t) => [t.name, t.rows]));
    const gone = Object.keys(input.before).filter((n) => !now.has(n));
    const shrunk = Object.entries(input.before)
      .filter(([n, c]) => now.has(n) && (now.get(n) as number) < c)
      .map(([n, c]) => `${n} ${c} to ${now.get(n)}`);
    checks.push({
      name: "No table disappeared",
      ok: gone.length === 0,
      detail: gone.length ? `missing: ${list(gone)}` : `${Object.keys(input.before).length} tables from the snapshot all present`,
    });
    checks.push({
      name: "No table lost rows",
      ok: shrunk.length === 0,
      detail: shrunk.length ? `fewer rows: ${list(shrunk)}` : "no count went down",
    });
    if (input.exact) {
      const different = Object.entries(input.before)
        .filter(([n, c]) => now.has(n) && (now.get(n) as number) !== c)
        .map(([n, c]) => `${n} ${c} to ${now.get(n)}`);
      const added = input.tables.filter((t) => !(t.name in (input.before as Record<string, number>))).map((t) => t.name);
      checks.push({
        name: "Counts equal the snapshot (--exact)",
        ok: different.length === 0 && added.length === 0,
        detail:
          different.length || added.length
            ? `different: ${list(different)}${added.length ? `; new tables: ${list(added)}` : ""}`
            : `${Object.keys(input.before).length} tables, every count equal`,
      });
    }
  } else if (input.noSnapshot) {
    checks.push({
      name: "Row counts compared with a snapshot",
      ok: true,
      skipped: true,
      detail: "skipped on purpose (--no-snapshot): this run is a health check, not a migration gate",
    });
  } else {
    checks.push({
      name: "Row counts compared with a snapshot",
      ok: false,
      detail: "no snapshot given: take one before the migration with --snapshot-out and pass it with --snapshot (or pass --no-snapshot for a plain health check)",
    });
  }

  if (input.appRead) {
    const r = input.appRead;
    checks.push({ name: "Connection works as the app role", ok: r.connected, detail: r.connected ? "connected" : (r.detail ?? "could not connect") });
    checks.push({
      name: "A read inside an organisation works",
      ok: r.connected && r.ownOrgVisible,
      detail: r.ownOrgVisible ? "own organisation row visible" : (r.detail ?? "own organisation row not visible"),
    });
    checks.push({
      name: "No organisation set shows no tenant rows",
      ok: r.connected && r.noOrgSeesRows === 0,
      detail: `${r.noOrgSeesRows} rows visible without an organisation`,
    });
  }

  return { ok: checks.every((c) => c.ok), checks, totalRows: input.tables.reduce((n, t) => n + t.rows, 0) };
}

export function formatReport(r: VerifyReport): string {
  const lines = r.checks.map((c) => `${c.skipped ? "SKIP" : c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
  const run = r.checks.filter((c) => !c.skipped);
  lines.push("", `${r.ok ? "PASS" : "FAIL"}  ${run.filter((c) => c.ok).length} of ${run.length} checks, ${r.totalRows} rows in total`);
  return lines.join("\n");
}
