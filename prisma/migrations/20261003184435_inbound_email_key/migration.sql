-- FIG-598: per-organization credential for the inbound-email webhook
-- (BCC-to-CRM / inbound-parse style logging of externally-sent emails).
--
-- Prisma's auto-generated diff for this migration also proposed DROPPING
-- every composite tenant-integrity foreign key (see the header comment on
-- `tenant_integrity_and_rls` for why those are hand-written and invisible
-- to schema.prisma). That diff was discarded; this file only adds what
-- FIG-598 actually needs, plus the composite FK and RLS this new table
-- needs to match every other organization-scoped table.

CREATE TABLE "inbound_email_keys" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "created_by_membership_id" TEXT,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_email_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inbound_email_keys_organization_id_key" ON "inbound_email_keys"("organization_id");

ALTER TABLE "inbound_email_keys" ADD CONSTRAINT "inbound_email_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inbound_email_keys" ADD CONSTRAINT "inbound_email_keys_created_by_membership_id_fkey" FOREIGN KEY ("created_by_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Composite tenant-integrity FK, same pattern as website_api_keys' own
-- created_by_membership_id column in tenant_integrity_and_rls.
ALTER TABLE "inbound_email_keys"
  ADD CONSTRAINT "inbound_email_keys_org_created_by_membership_fk"
  FOREIGN KEY ("organization_id", "created_by_membership_id")
  REFERENCES "memberships" ("organization_id", "id");

-- Ordinary organization-scoped table, read/written by the application
-- through the RLS-scoped figbloom_app role like any other -- no custom
-- grant/revoke needed beyond the blanket ALL TABLES grant
-- `scripts/db-admin.ts#grantRole` already re-applies on every run.
ALTER TABLE "inbound_email_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inbound_email_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "inbound_email_keys"
  USING (organization_id = current_setting('app.current_organization_id', true));
