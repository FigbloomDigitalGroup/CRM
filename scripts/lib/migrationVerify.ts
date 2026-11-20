/** Pure part of the post-migration verification (FIG-1603, P2-20 section C.5). The CLI is scripts/verify-migration.ts. */

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
  /** undefined when no app connection was given. */
  appRead?: { connected: boolean; ownOrgVisible: boolean; noOrgSeesRows: number; detail?: string };
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
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
  const noGrant = input.tables.filter((t) => !t.appCanSelect).map((t) => t.name);
  checks.push({
    name: "App role can read every table",
    ok: input.appRoleExists && noGrant.length === 0,
    detail: noGrant.length ? `no SELECT on: ${list(noGrant)} (run npm run db:grant-role)` : "SELECT granted on all tables",
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
  } else {
    checks.push({
      name: "Row counts compared with a snapshot",
      ok: false,
      detail: "no snapshot given: take one before the migration with --snapshot-out and pass it with --snapshot",
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
  const lines = r.checks.map((c) => `${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
  lines.push("", `${r.ok ? "PASS" : "FAIL"}  ${r.checks.filter((c) => c.ok).length} of ${r.checks.length} checks, ${r.totalRows} rows in total`);
  return lines.join("\n");
}
