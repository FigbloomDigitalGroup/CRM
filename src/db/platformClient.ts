import { PrismaClient } from "@prisma/client";

/**
 * Platform Prisma client (FIG-1135, B6.03) -- connects as the dedicated
 * `figbloom_platform` Postgres role (scripts/db-admin.ts), never as the schema
 * owner and never as the tenant `figbloom_app` role.
 *
 * What that role can touch is decided by the database, not by this file:
 *   - `platform_identities` and `platform_sessions` (its own tables), and
 *   - the `platform_organization_counts` view (numbers only).
 * It has no privilege on any tenant table, so a bug or injection in platform
 * code cannot read a customer record, a deal value or a payment: Postgres
 * answers "permission denied".
 *
 * Fail closed: with no PLATFORM_DATABASE_URL the client is not created, and the
 * first use throws. It is never quietly replaced by `adminDb`.
 */
const globalForPrisma = globalThis as unknown as { platformDbClient?: PrismaClient };

function create(): PrismaClient {
  const url = process.env.PLATFORM_DATABASE_URL;
  if (!url) {
    throw new Error(
      "PLATFORM_DATABASE_URL is not set (the figbloom_platform role's connection string; see .env.example).",
    );
  }
  return new PrismaClient({ datasourceUrl: url });
}

/** The platform-role client, created on first use. */
export function getPlatformDb(): PrismaClient {
  globalForPrisma.platformDbClient ??= create();
  return globalForPrisma.platformDbClient;
}
