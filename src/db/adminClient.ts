import { PrismaClient } from "@prisma/client";

/**
 * Administrative Prisma client — connects using DATABASE_URL (the schema
 * owner). Row-level security has no effect on this connection, so it must
 * only be used for genuinely platform-level operations that legitimately
 * precede or sit outside any single organization's context:
 *
 *   - provisioning a new Organization (FIG-437 section 13: "Controlled
 *     platform/administrative process creates the tenant boundary")
 *   - seeding global catalogs (roles, permissions) and per-organization
 *     reference data
 *   - migrations and test setup/teardown
 *
 * Ordinary CRM business-record access must go through
 * src/db/orgScopedClient.ts (`withOrgContext`) instead, so that tenant
 * isolation is enforced by the database (RLS) and not merely assumed by
 * application code (FIG-437 section 16, "Server-Side Enforcement").
 */
export const adminDb = new PrismaClient();
