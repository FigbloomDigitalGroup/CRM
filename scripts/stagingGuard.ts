/**
 * Shared guard for the staging-only scripts (FIG-1123, P1.01): `staging-refresh.ts` and `staging-seed.ts`.
 * They rewrite or add data in bulk, so they run only when the environment says, out loud, that it is staging.
 *
 * Fail closed: anything that is not clearly staging is refused, and production is refused by name.
 *   - `FIGBLOOM_ENVIRONMENT` must be exactly "staging" (production sets it to "production"; unset is refused).
 *   - `ALLOW_DEV_ACCOUNTS` must not be "true" (CLAUDE.md rule 10: staging has no dev accounts).
 *   - The target database name must contain "staging", and must not be the database named in
 *     `PRODUCTION_DATABASE_URL` (never set on staging; an extra tripwire for a copied environment file).
 *
 * Only the database NAME is ever printed, never the connection string.
 */
type Env = Record<string, string | undefined>;

export const STAGING_EMAIL_DOMAIN = "staging.example.com";

export const UAT_ROLES = ["MANAGEMENT", "SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL", "CUSTOMER_SUPPORT"] as const;

/** Anonymised users start with "u" plus hex; UAT sign-ins start with "uat-" (the refresh residue check relies on this). */
export function uatEmail(roleKey: string): string {
  return `uat-${roleKey.toLowerCase().replace(/_/g, "-")}@${STAGING_EMAIL_DOMAIN}`;
}

function parseDatabase(url: string): { host: string; port: string; name: string } {
  const u = new URL(url);
  return { host: u.hostname, port: u.port || "5432", name: decodeURIComponent(u.pathname.replace(/^\//, "")) };
}

/** Throws unless this process may run staging-only scripts against `DATABASE_URL`. Returns the database name. */
export function assertStagingEnvironment(env: Env = process.env): string {
  if (env.FIGBLOOM_ENVIRONMENT === "production") {
    throw new Error("Refusing to run: FIGBLOOM_ENVIRONMENT is production. This script exists for staging only.");
  }
  if (env.FIGBLOOM_ENVIRONMENT !== "staging") {
    throw new Error('Refusing to run: set FIGBLOOM_ENVIRONMENT="staging" to confirm this is the staging environment.');
  }
  if (env.ALLOW_DEV_ACCOUNTS === "true") {
    throw new Error("Refusing to run: ALLOW_DEV_ACCOUNTS=true. Staging must not allow dev accounts (CLAUDE.md rule 10).");
  }
  const url = env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL must be set to the staging database (schema owner connection).");

  let target: ReturnType<typeof parseDatabase>;
  try {
    target = parseDatabase(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid connection string.");
  }
  if (!/staging/i.test(target.name)) {
    throw new Error(`Refusing to run: the database name "${target.name}" does not contain "staging".`);
  }
  if (env.PRODUCTION_DATABASE_URL) {
    let prod: ReturnType<typeof parseDatabase> | undefined;
    try {
      prod = parseDatabase(env.PRODUCTION_DATABASE_URL);
    } catch {
      /* an unparsable tripwire value is ignored; the other checks still apply */
    }
    if (prod && prod.host === target.host && prod.port === target.port && prod.name === target.name) {
      throw new Error("Refusing to run: DATABASE_URL points at the production database.");
    }
  }
  return target.name;
}

/** For destructive commands: the operator must type the database name into `STAGING_REFRESH_CONFIRM`. */
export function assertConfirmed(databaseName: string, env: Env = process.env, argv: string[] = process.argv) {
  if (!argv.includes("--yes") || env.STAGING_REFRESH_CONFIRM !== databaseName) {
    throw new Error(
      `This rewrites data in "${databaseName}". Re-run with --yes and STAGING_REFRESH_CONFIRM=${databaseName} to confirm.`,
    );
  }
}

/**
 * A database error can quote the row that caused it ("Key (email)=(...) already exists"), which would put real data in a log.
 * Print only the structural fields.
 */
export function describeDbError(err: unknown): string {
  const e = err as { code?: string; table?: string; column?: string; constraint?: string; schema?: string } | null;
  if (e && typeof e === "object" && "code" in e) {
    const parts = [`code=${e.code ?? "?"}`];
    if (e.table) parts.push(`table=${e.table}`);
    if (e.column) parts.push(`column=${e.column}`);
    if (e.constraint) parts.push(`constraint=${e.constraint}`);
    return `database error (${parts.join(", ")}); the message is withheld because it may quote a row`;
  }
  return err instanceof Error ? err.message : "unknown error";
}
