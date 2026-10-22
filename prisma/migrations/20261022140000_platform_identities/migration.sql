-- FIG-1196 (B0.09): platform_identities, the separate identity a Platform
-- Super Admin signs in with. It is deliberately NOT a row in `users`: it has
-- no memberships, no organization and no tenant permissions, so it can never
-- resolve a tenant context. Today it holds only the dev-only Super Admin
-- fixture (is_dev = true), created by `npm run seed:dev`, never by a
-- migration or the production seed. B6.03 adopts this table for real platform
-- admins.
--
-- Hand-written, same reasoning as `deal_handoffs`: Prisma's auto-diff would
-- also propose dropping the hand-written composite tenant foreign keys.

CREATE TABLE "platform_identities" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT,
    "is_dev" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_identities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_identities_email_key" ON "platform_identities"("email");

-- Two walls keep the tenant-facing application role out of this table:
--  1. Row-level security is on and forced with no policy, so no row is ever
--     visible to a role that does not bypass RLS.
--  2. The role's privileges are revoked outright (and re-revoked by
--     `npm run db:grant-role`, which grants on all tables each time).
-- Platform code reads it through the schema-owner connection, like `users`.
ALTER TABLE "platform_identities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_identities" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'figbloom_app') THEN
    EXECUTE 'REVOKE SELECT, INSERT, UPDATE, DELETE ON "platform_identities" FROM figbloom_app';
  ELSE
    RAISE NOTICE 'Role "figbloom_app" does not exist yet -- run "npm run db:bootstrap-role" then "npm run db:grant-role" to finish granting privileges.';
  END IF;
END
$$;
