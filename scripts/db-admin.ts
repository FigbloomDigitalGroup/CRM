/**
 * One-off, cluster-level database administration tasks that must never be
 * expressed as versioned Prisma migrations because they involve a secret
 * (the application role's password) or are cluster- rather than
 * schema-scoped. See prisma/migrations/*_tenant_integrity_and_rls and
 * README.md "Row-level security" for context.
 *
 * Usage:
 *   tsx scripts/db-admin.ts bootstrap-role   # create/update figbloom_app + password
 *   tsx scripts/db-admin.ts grant-role       # (re-)apply grants once the role exists
 */
import "dotenv/config";
import { Client } from "pg";

const APP_ROLE = process.env.APP_DB_ROLE ?? "figbloom_app";
const PLATFORM_ROLE = process.env.PLATFORM_DB_ROLE ?? "figbloom_platform";
// FIG-1136 to FIG-1141 (B6.04 to B6.09): platform console objects (migration 20261105100000).
const PLATFORM_CONSOLE_APPEND_ONLY = [
  "platform_audit_events",
  "platform_audit_verifications",
  "organization_lifecycle_events",
  "platform_data_request_approvals",
  "platform_deletion_certificates",
];
const PLATFORM_CONSOLE_MUTABLE = ["platform_idempotency_keys", "platform_incidents", "platform_data_requests", "platform_announcements"];
/** FIG-1183 (B7.01): support access. These carry an organisation id, so the platform role has no privilege on them (it uses the support_access_* functions); the tenant role approves, denies and ends a grant, and only reads the page-view log. */
const SUPPORT_ACCESS_GRANTS = "support_access_grants";
const SUPPORT_ACCESS_PAGE_VIEWS = "support_access_page_views";
const PLATFORM_CONSOLE_VIEWS = ["platform_jobs_health", "platform_email_health", "platform_organization_profile"];
/** FIG-1134 (B6.02): two-step tables, revoked from the tenant role (`TWO_STEP_TENANT_TABLES` and `TWO_STEP_PLATFORM_TABLES`); the platform ones are granted to the platform role. */
const TWO_STEP_TENANT_TABLES = ["user_two_step", "user_backup_codes", "user_trusted_devices", "two_step_challenges"];
/** FIG-1140 (B6.08) adds the invitation and settings tables to the same list. */
const TWO_STEP_PLATFORM_TABLES = ["platform_two_step", "platform_backup_codes", "platform_two_step_challenges", "platform_admin_invites", "platform_settings"];
const APP_DBS = (
  process.env.APP_DB_NAMES ?? "figbloom_crm_dev,figbloom_crm_test"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function requireAdminUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL must be set to an administrative (superuser) connection string.",
    );
  }
  return url;
}

/** Quote a Postgres identifier safely for use inside a dynamic statement. */
function ident(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Refusing to use unsafe identifier: ${name}`);
  }
  return `"${name}"`;
}

async function bootstrapRole(): Promise<void> {
  const password = process.env.APP_DB_PASSWORD;
  if (!password) {
    throw new Error(
      "APP_DB_PASSWORD is not set. Set it in your environment (never commit it) before running bootstrap-role.",
    );
  }

  const client = new Client({ connectionString: requireAdminUrl() });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [APP_ROLE],
    );
    if (rows.length === 0) {
      // Role names are validated above; the password is sent as a bound
      // parameter is not supported by CREATE ROLE (a utility statement), so
      // we use Postgres dollar-quoting to avoid manual escaping issues.
      await client.query(
        `CREATE ROLE ${ident(APP_ROLE)} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD $pw$${password}$pw$`,
      );
      console.log(`Created role "${APP_ROLE}".`);
    } else {
      await client.query(
        `ALTER ROLE ${ident(APP_ROLE)} PASSWORD $pw$${password}$pw$`,
      );
      const appAttrs = await client.query(
        "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1",
        [APP_ROLE],
      );
      if (appAttrs.rows[0]?.rolsuper || appAttrs.rows[0]?.rolbypassrls) {
        throw new Error(
          `Role "${APP_ROLE}" has SUPERUSER or BYPASSRLS. It must have neither (row-level security would not apply); fix the role before continuing.`,
        );
      }
      console.log(`Role "${APP_ROLE}" already exists -- password updated.`);
    }

    for (const db of APP_DBS) {
      await client.query(
        `GRANT CONNECT ON DATABASE ${ident(db)} TO ${ident(APP_ROLE)}`,
      );
    }
    console.log(`Granted CONNECT on: ${APP_DBS.join(", ")}`);

    // FIG-1135 (B6.03): the dedicated platform role. NOBYPASSRLS and no tenant
    // privilege (see grantRole). Skipped when PLATFORM_DB_PASSWORD is not set.
    const platformPassword = process.env.PLATFORM_DB_PASSWORD;
    if (platformPassword) {
      const existing = await client.query(
        "SELECT 1 FROM pg_roles WHERE rolname = $1",
        [PLATFORM_ROLE],
      );
      if (existing.rows.length === 0) {
        await client.query(
          `CREATE ROLE ${ident(PLATFORM_ROLE)} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD $pw$${platformPassword}$pw$`,
        );
        console.log(`Created role "${PLATFORM_ROLE}".`);
      } else {
        // The migration creates it NOLOGIN: give it LOGIN and the password here.
        // Only LOGIN and the password are changed here: managed hosts (Neon) refuse
        // `ALTER ROLE ... NOSUPERUSER NOBYPASSRLS` from a non-superuser owner. The
        // protections are checked instead of re-asserted, and the run fails if either is missing.
        await client.query(
          `ALTER ROLE ${ident(PLATFORM_ROLE)} LOGIN PASSWORD $pw$${platformPassword}$pw$`,
        );
        const attrs = await client.query(
          "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1",
          [PLATFORM_ROLE],
        );
        if (attrs.rows[0]?.rolsuper || attrs.rows[0]?.rolbypassrls) {
          throw new Error(
            `Role "${PLATFORM_ROLE}" has SUPERUSER or BYPASSRLS. It must have neither; fix the role before continuing.`,
          );
        }
        console.log(`Role "${PLATFORM_ROLE}" already exists -- login and password updated (not superuser, no RLS bypass).`);
      }
      for (const db of APP_DBS) {
        await client.query(
          `GRANT CONNECT ON DATABASE ${ident(db)} TO ${ident(PLATFORM_ROLE)}`,
        );
      }
    } else {
      console.log(
        `PLATFORM_DB_PASSWORD is not set -- skipped login for "${PLATFORM_ROLE}" (platform sign-in will not work).`,
      );
    }
  } finally {
    await client.end();
  }
}

async function grantRole(): Promise<void> {
  const client = new Client({ connectionString: requireAdminUrl() });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [APP_ROLE],
    );
    if (rows.length === 0) {
      throw new Error(
        `Role "${APP_ROLE}" does not exist. Run bootstrap-role first.`,
      );
    }

    await client.query(`GRANT USAGE ON SCHEMA public TO ${ident(APP_ROLE)}`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ident(APP_ROLE)}`,
    );
    await client.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ident(APP_ROLE)}`,
    );
    await client.query(
      `REVOKE UPDATE, DELETE ON "audit_events" FROM ${ident(APP_ROLE)}`,
    );
    // FIG-594: this role only ever reads website_lead_request_log (the
    // public lead-capture endpoint writes it via the schema-owner adminDb
    // connection, before any RLS context exists) -- revoke write access
    // outright rather than leaving it merely unused.
    await client.query(
      `REVOKE INSERT, UPDATE, DELETE ON "website_lead_request_log" FROM ${ident(APP_ROLE)}`,
    );
    // FIG-784: this role has no business with the rate-limit counter at
    // all -- every write and every count-based read happens via the
    // schema-owner adminDb connection, before any org/session context
    // exists. Revoked outright, stricter than website_lead_request_log's
    // write-only revoke above since there isn't even a read-side use.
    await client.query(
      `REVOKE SELECT, INSERT, UPDATE, DELETE ON "auth_rate_limit_attempts" FROM ${ident(APP_ROLE)}`,
    );
    // FIG-1196: platform identities (the Platform Super Admin, dev fixture
    // today) are never touched by the tenant-facing role: revoked outright,
    // with row-level security on and no policy as the second wall.
    await client.query(
      `REVOKE SELECT, INSERT, UPDATE, DELETE ON "platform_identities" FROM ${ident(APP_ROLE)}`,
    );
    // FIG-1135: platform sessions and the operational-count view belong to the
    // platform role alone.
    await client.query(
      `REVOKE SELECT, INSERT, UPDATE, DELETE ON "platform_sessions" FROM ${ident(APP_ROLE)}`,
    );
    await client.query(
      `REVOKE SELECT, INSERT, UPDATE, DELETE ON "platform_organization_counts" FROM ${ident(APP_ROLE)}`,
    );
    // FIG-1134 (B6.02): two-step secrets, backup codes and challenges are read
    // only through the schema-owner connection; the tenant role never sees them.
    for (const table of TWO_STEP_TENANT_TABLES.concat(TWO_STEP_PLATFORM_TABLES)) {
      await client.query(`REVOKE ALL ON "${table}" FROM ${ident(APP_ROLE)}`);
    }
    // FIG-1136 to FIG-1141 (B6.04 to B6.09): the platform console's own tables
    // and counts views are the platform role's alone.
    for (const name of PLATFORM_CONSOLE_APPEND_ONLY.concat(PLATFORM_CONSOLE_MUTABLE, PLATFORM_CONSOLE_VIEWS)) {
      await client.query(`REVOKE ALL ON "${name}" FROM ${ident(APP_ROLE)}`);
    }
    // FIG-1183: the tenant side approves or ends a grant; it never creates or deletes one, and never writes the page-view log.
    await client.query(`REVOKE INSERT, DELETE ON "${SUPPORT_ACCESS_GRANTS}" FROM ${ident(APP_ROLE)}`);
    await client.query(`REVOKE INSERT, UPDATE, DELETE ON "${SUPPORT_ACCESS_PAGE_VIEWS}" FROM ${ident(APP_ROLE)}`);
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ident(APP_ROLE)}`,
    );

    // FIG-1135: the platform role gets exactly its own two tables and the
    // counts view. Everything is revoked first, so re-running this never leaves
    // a tenant privilege behind. Default privileges grant it nothing.
    const platform = await client.query(
      "SELECT 1 FROM pg_roles WHERE rolname = $1",
      [PLATFORM_ROLE],
    );
    if (platform.rows.length > 0) {
      await client.query(
        `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ident(PLATFORM_ROLE)}`,
      );
      await client.query(
        `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${ident(PLATFORM_ROLE)}`,
      );
      await client.query(`GRANT USAGE ON SCHEMA public TO ${ident(PLATFORM_ROLE)}`);
      await client.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON "platform_identities", "platform_sessions" TO ${ident(PLATFORM_ROLE)}`,
      );
      await client.query(
        `GRANT SELECT ON "platform_organization_counts" TO ${ident(PLATFORM_ROLE)}`,
      );
      // FIG-1134 (B6.02): the platform admin's own two-step tables.
      for (const table of TWO_STEP_PLATFORM_TABLES) {
        await client.query(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON "${table}" TO ${ident(PLATFORM_ROLE)}`,
        );
      }
      // FIG-1136 to FIG-1141: console tables. Append-only ones (the audit log, the lifecycle trail,
      // approvals, certificates) get SELECT and INSERT only; triggers also refuse UPDATE and DELETE.
      for (const table of PLATFORM_CONSOLE_APPEND_ONLY) {
        await client.query(`GRANT SELECT, INSERT ON "${table}" TO ${ident(PLATFORM_ROLE)}`);
      }
      for (const table of PLATFORM_CONSOLE_MUTABLE) {
        await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "${table}" TO ${ident(PLATFORM_ROLE)}`);
      }
      for (const view of PLATFORM_CONSOLE_VIEWS) {
        await client.query(`GRANT SELECT ON "${view}" TO ${ident(PLATFORM_ROLE)}`);
      }
      console.log(`Granted "${PLATFORM_ROLE}" its platform tables and the counts view only.`);
    }
    console.log(
      `Granted table privileges to "${APP_ROLE}" (audit_events remains append-only; website_lead_request_log, auth_rate_limit_attempts and platform_identities are restricted).`,
    );
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  switch (command) {
    case "bootstrap-role":
      await bootstrapRole();
      break;
    case "grant-role":
      await grantRole();
      break;
    default:
      console.error(
        "Usage: tsx scripts/db-admin.ts <bootstrap-role|grant-role>",
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
