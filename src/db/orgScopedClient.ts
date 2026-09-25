import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Org-scoped Prisma client — connects as the least-privilege `figbloom_app`
 * Postgres role (see scripts/db-admin.ts), the only role RLS actually
 * restricts. Never export this client for direct unscoped use; all access
 * must go through `withOrgContext`.
 *
 * Cached on `globalThis` in dev for the same reason as `adminDb` in
 * src/db/adminClient.ts -- see that file's comment.
 */
const globalForPrisma = globalThis as unknown as { appDb?: PrismaClient };

const appDb =
  globalForPrisma.appDb ??
  new PrismaClient({ datasourceUrl: process.env.APP_DATABASE_URL });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.appDb = appDb;
}

export type OrgScopedClient = Prisma.TransactionClient;

/**
 * Establishes the active-organization context required by FIG-437 section
 * 7 ("Active Organization Context") before running `fn`, and enforces it at
 * two independent layers:
 *
 *   1. Database (primary, defense-in-depth): `set_config` sets the
 *      Postgres session variable the RLS policies from
 *      *_tenant_integrity_and_rls check. It is set with `is_local = true`
 *      inside a transaction, so it can never leak onto a pooled connection
 *      outside this call.
 *   2. Application (the caller's responsibility): repositories built on top
 *      of this helper must still filter by `organizationId` explicitly.
 *      RLS is the backstop for when that filter is missing, not a
 *      replacement for it (FIG-437 section 16, "Defense in Depth").
 *
 * `organizationId` must come from an already-authorized membership lookup,
 * never taken as-is from an unauthenticated client request (FIG-437
 * section 7: "A client-supplied organization ID is never sufficient
 * authorization by itself").
 */
export async function withOrgContext<T>(
  organizationId: string,
  fn: (tx: OrgScopedClient) => Promise<T>,
): Promise<T> {
  if (!organizationId) {
    // Fail closed (FIG-437 section 16) rather than running the callback
    // with no tenant context at all.
    throw new Error("withOrgContext requires a non-empty organizationId.");
  }

  return appDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_organization_id', ${organizationId}, true)`;
    return fn(tx);
  });
}

/** For tests only: proves RLS still fails closed with no context set. */
export function getUnscopedAppClientForTests(): PrismaClient {
  return appDb;
}

export { appDb };
