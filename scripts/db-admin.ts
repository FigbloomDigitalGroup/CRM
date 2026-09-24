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
      console.log(`Role "${APP_ROLE}" already exists -- password updated.`);
    }

    for (const db of APP_DBS) {
      await client.query(
        `GRANT CONNECT ON DATABASE ${ident(db)} TO ${ident(APP_ROLE)}`,
      );
    }
    console.log(`Granted CONNECT on: ${APP_DBS.join(", ")}`);
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
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ident(APP_ROLE)}`,
    );
    console.log(
      `Granted table privileges to "${APP_ROLE}" (audit_events remains append-only).`,
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
