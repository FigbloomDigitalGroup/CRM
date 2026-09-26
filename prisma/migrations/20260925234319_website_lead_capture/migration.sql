-- FIG-442: website_api_keys table (the credential that authenticates the
-- public, session-less website lead-capture endpoint).
--
-- Prisma's auto-generated diff for this migration also proposed DROPPING
-- every composite tenant-integrity foreign key added by the earlier
-- hand-written `tenant_integrity_and_rls` migration, because those
-- constraints exist only in the database, not in schema.prisma (see that
-- migration's own header comment for why they're hand-written). That diff
-- was discarded; this file only adds what FIG-442 actually needs, using the
-- exact same hand-written pattern as `tenant_integrity_and_rls` for the new
-- table's composite FK and RLS policy.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

CREATE TABLE "website_api_keys" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "created_by_membership_id" TEXT,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "website_api_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "website_api_keys_organization_id_key" ON "website_api_keys"("organization_id");

ALTER TABLE "website_api_keys" ADD CONSTRAINT "website_api_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "website_api_keys" ADD CONSTRAINT "website_api_keys_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Composite tenant-integrity foreign key (see tenant_integrity_and_rls's
--    header comment for the full mechanism: this makes it impossible for a
--    row to reference a membership belonging to a different organization).
-- ---------------------------------------------------------------------------

ALTER TABLE "website_api_keys"
  ADD CONSTRAINT "website_api_keys_org_created_by_membership_fk"
  FOREIGN KEY ("organization_id", "created_by_membership_id")
  REFERENCES "memberships" ("organization_id", "id");

-- ---------------------------------------------------------------------------
-- 3. Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE "website_api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "website_api_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "website_api_keys"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

-- Table privileges for the least-privilege `figbloom_app` role are already
-- covered by `tenant_integrity_and_rls`'s `ALTER DEFAULT PRIVILEGES ... GRANT
-- SELECT, INSERT, UPDATE, DELETE ON TABLES TO figbloom_app`, which applies to
-- every table created afterward by the same migration user -- no additional
-- GRANT needed here. The public lead-capture endpoint itself never queries
-- this table through `figbloom_app`/RLS at all; it looks up the key via the
-- schema-owner `adminDb` connection (see src/auth/websiteApiKey.ts), the same
-- documented exception already used for resolving the Organization/User
-- rows that precede any org context (src/db/adminClient.ts).
