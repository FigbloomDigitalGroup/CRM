-- FIG-594: abuse-protection fields on website_api_keys, plus a new
-- website_lead_request_log table for rate limiting and monitoring.
--
-- Prisma's auto-generated diff for this migration also proposed DROPPING
-- every composite tenant-integrity foreign key (see the header comment on
-- `tenant_integrity_and_rls` for why those are hand-written and invisible
-- to schema.prisma). That diff was discarded; this file only adds what
-- FIG-594 actually needs.

-- ---------------------------------------------------------------------------
-- 1. New abuse-protection columns on website_api_keys
-- ---------------------------------------------------------------------------

ALTER TABLE "website_api_keys"
  ADD COLUMN "allowed_origins" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "captcha_secret" TEXT,
  ADD COLUMN "honeypot_field_name" TEXT,
  ADD COLUMN "revoked_at" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- 2. website_lead_request_log
-- ---------------------------------------------------------------------------

CREATE TABLE "website_lead_request_log" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT,
    "key_hash" TEXT,
    "ip_address" TEXT,
    "origin" TEXT,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "lead_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_lead_request_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "website_lead_request_log_organization_id_created_at_idx" ON "website_lead_request_log"("organization_id", "created_at");

-- keyHash (not the short display keyPrefix) is the rate-limit bucket
-- identity -- see the model's doc comment in schema.prisma for why.
CREATE INDEX "website_lead_request_log_key_hash_created_at_idx" ON "website_lead_request_log"("key_hash", "created_at");

CREATE INDEX "website_lead_request_log_ip_address_created_at_idx" ON "website_lead_request_log"("ip_address", "created_at");

ALTER TABLE "website_lead_request_log" ADD CONSTRAINT "website_lead_request_log_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Row-level security
-- ---------------------------------------------------------------------------
--
-- Every write to this table happens through the schema-owner `adminDb`
-- connection (see src/repositories/websiteLeadRequestLog.ts) -- the public
-- endpoint runs before any org context/RLS session variable can be set, the
-- same documented exception already used for resolving the Organization
-- and WebsiteApiKey rows that precede it. `figbloom_app` (the RLS-scoped
-- role the authenticated monitoring UI reads through) only ever needs
-- SELECT here, so INSERT/UPDATE/DELETE are revoked outright -- stricter
-- than audit_events' "UPDATE/DELETE revoked, INSERT allowed" append-only
-- treatment, since this role never inserts at all.
--
-- The revoke is repeated in `scripts/db-admin.ts#grantRole` (same reason
-- that function already special-cases audit_events): it re-grants
-- SELECT/INSERT/UPDATE/DELETE on every table, so without a matching
-- revoke there, the next `npm run db:grant-role` would silently undo this
-- one. Guarded the same defensive way as `tenant_integrity_and_rls` -- this
-- migration must still succeed if the role hasn't been bootstrapped yet.

ALTER TABLE "website_lead_request_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "website_lead_request_log" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "website_lead_request_log"
  USING (organization_id = current_setting('app.current_organization_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'figbloom_app') THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON "website_lead_request_log" FROM figbloom_app';
  ELSE
    RAISE NOTICE 'Role "figbloom_app" does not exist yet -- run "npm run db:bootstrap-role" then "npm run db:grant-role" to finish granting privileges.';
  END IF;
END
$$;
