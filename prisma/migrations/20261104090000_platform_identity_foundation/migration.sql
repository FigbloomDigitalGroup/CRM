-- FIG-1135 (B6.03): platform identity foundation.
--
-- The Platform Super Admin is a separate identity (platform_identities, from
-- FIG-1196) with its own session type, its own `platform.*` permission keys
-- (src/auth/platformPermissions.ts) and its own database role. Nothing here
-- touches a tenant table: the new role gets no privilege on any of them, and
-- every tenant table already has row-level security forced with policies that
-- name only the application role, so the platform role is denied twice.
--
-- Hand-written, same reasoning as `platform_identities`: Prisma's auto-diff
-- would also propose dropping the hand-written composite tenant foreign keys.

-- 1. The identity gains a status (a suspended admin cannot sign in) and a
--    last sign-in time.
ALTER TABLE "platform_identities" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "platform_identities" ADD COLUMN "last_sign_in_at" TIMESTAMP(3);
ALTER TABLE "platform_identities"
  ADD CONSTRAINT "platform_identities_status_check" CHECK ("status" IN ('ACTIVE', 'SUSPENDED'));

-- 2. Platform sessions: a separate session type. Same shape as tenant
--    `sessions` (hashed token, revocable, idle and absolute expiry) but with a
--    foreign key to platform_identities and no organisation at all.
CREATE TABLE "platform_sessions" (
    "id" TEXT NOT NULL,
    "platform_identity_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "absolute_expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,
    "user_agent" TEXT,
    "ip_address" TEXT,

    CONSTRAINT "platform_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_sessions_token_hash_key" ON "platform_sessions"("token_hash");
CREATE INDEX "platform_sessions_platform_identity_id_idx" ON "platform_sessions"("platform_identity_id");

ALTER TABLE "platform_sessions"
  ADD CONSTRAINT "platform_sessions_platform_identity_id_fkey"
  FOREIGN KEY ("platform_identity_id") REFERENCES "platform_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. The dedicated database role. Created NOLOGIN here so the policies below
--    can name it; `npm run db:bootstrap-role` gives it LOGIN and its password
--    (a secret, so never in a migration). NOBYPASSRLS and NOSUPERUSER, so RLS
--    always applies to it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'figbloom_platform') THEN
    CREATE ROLE figbloom_platform NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

-- 4. Walls on the two platform tables. RLS is on and forced. The platform role
--    gets a policy (it must read and write its own identity and sessions);
--    the tenant application role has none, so it sees no row, and its table
--    privileges are revoked as the second wall.
ALTER TABLE "platform_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_sessions" FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_access ON "platform_identities"
  FOR ALL TO figbloom_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_access ON "platform_sessions"
  FOR ALL TO figbloom_platform USING (true) WITH CHECK (true);

-- 5. Operational counts for the platform screens: one row per organisation,
--    numbers only. No name of a customer, no deal value, no payment, no
--    free text. The view runs as its owner (the schema owner, which bypasses
--    RLS like `adminDb`), which is the only way the platform role can see a
--    count of rows it may not read. Columns are listed one by one so a new
--    column on a tenant table can never leak through `SELECT *`.
CREATE VIEW "platform_organization_counts" AS
SELECT
  o."id"         AS organization_id,
  o."slug"       AS slug,
  o."name"       AS name,
  o."status"::text AS status,
  o."created_at" AS created_at,
  (SELECT count(*) FROM "memberships" m WHERE m."organization_id" = o."id")                           AS member_count,
  (SELECT count(*) FROM "memberships" m WHERE m."organization_id" = o."id" AND m."status"::text = 'ACTIVE') AS active_member_count,
  (SELECT count(*) FROM "companies"   c WHERE c."organization_id" = o."id")                           AS company_count,
  (SELECT count(*) FROM "contacts"    c WHERE c."organization_id" = o."id")                           AS contact_count,
  (SELECT count(*) FROM "leads"       l WHERE l."organization_id" = o."id")                           AS lead_count,
  (SELECT count(*) FROM "deals"       d WHERE d."organization_id" = o."id")                           AS deal_count
FROM "organizations" o;

-- 6. Privileges. Revoke the tenant application role from the new table, and
--    give the platform role exactly its own tables plus the counts view.
--    (`npm run db:grant-role` re-applies all of this, because the tenant
--    role's grant covers every table each time it runs.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'figbloom_app') THEN
    EXECUTE 'REVOKE SELECT, INSERT, UPDATE, DELETE ON "platform_sessions" FROM figbloom_app';
    EXECUTE 'REVOKE SELECT, INSERT, UPDATE, DELETE ON "platform_organization_counts" FROM figbloom_app';
  ELSE
    RAISE NOTICE 'Role "figbloom_app" does not exist yet -- run "npm run db:bootstrap-role" then "npm run db:grant-role" to finish granting privileges.';
  END IF;

  EXECUTE 'GRANT USAGE ON SCHEMA public TO figbloom_platform';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "platform_identities", "platform_sessions" TO figbloom_platform';
  EXECUTE 'GRANT SELECT ON "platform_organization_counts" TO figbloom_platform';
END
$$;
