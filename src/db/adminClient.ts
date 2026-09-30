import { PrismaClient } from "@prisma/client";

/**
 * Administrative Prisma client -- connects using DATABASE_URL (the schema
 * owner). Row-level security has no effect on this connection, so it's only
 * for platform-level operations that precede or sit outside any single
 * organization's context:
 *
 *   - provisioning a new Organization
 *   - seeding global catalogs (roles, permissions) and per-organization
 *     reference data
 *   - migrations and test setup/teardown
 *
 * Ordinary CRM business-record access must go through
 * src/db/orgScopedClient.ts (`withOrgContext`) instead, so tenant isolation
 * is enforced by the database (RLS) rather than assumed by application code.
 *
 * Cached on `globalThis` in dev: `next dev`'s hot-reload re-runs this module
 * on every save without calling `$disconnect()` on the previous instance, so
 * without the cache each reload leaks a connection pool until Postgres's
 * `max_connections` is exhausted (the standard Prisma-on-Next.js pitfall; see
 * https://www.prisma.io/docs/guides/nextjs). Production has one long-lived
 * process, so the cache is a no-op there.
 */
const globalForPrisma = globalThis as unknown as { adminDb?: PrismaClient };

export const adminDb = globalForPrisma.adminDb ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.adminDb = adminDb;
}
