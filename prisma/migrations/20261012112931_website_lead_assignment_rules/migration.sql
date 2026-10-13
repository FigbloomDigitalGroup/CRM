-- FIG-751: website_lead_assignment_rules table.
--
-- Prisma's auto-generated diff for this migration also proposed DROPPING
-- every composite tenant-integrity foreign key added by the earlier
-- hand-written `tenant_integrity_and_rls` migration, because those
-- constraints exist only in the database, not in schema.prisma (see that
-- migration's own header comment for why they're hand-written, and
-- `website_lead_capture`'s header comment for the same discard). That diff
-- was discarded; this file only adds what FIG-751 actually needs, using the
-- exact same hand-written pattern as `tenant_integrity_and_rls` for the new
-- table's composite FKs and RLS policy.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

CREATE TABLE "website_lead_assignment_rules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lead_source_id" TEXT,
    "service_id" TEXT,
    "assignee_membership_id" TEXT,
    "assignee_membership_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_assigned_membership_id" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "website_lead_assignment_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "website_lead_assignment_rules_organization_id_is_active_seq_idx" ON "website_lead_assignment_rules"("organization_id", "is_active", "sequence");

CREATE UNIQUE INDEX "website_lead_assignment_rules_organization_id_id_key" ON "website_lead_assignment_rules"("organization_id", "id");

ALTER TABLE "website_lead_assignment_rules" ADD CONSTRAINT "website_lead_assignment_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "website_lead_assignment_rules" ADD CONSTRAINT "website_lead_assignment_rules_lead_source_id_fkey" FOREIGN KEY ("lead_source_id") REFERENCES "lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "website_lead_assignment_rules" ADD CONSTRAINT "website_lead_assignment_rules_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "website_lead_assignment_rules" ADD CONSTRAINT "website_lead_assignment_rules_assignee_membership_id_fkey" FOREIGN KEY ("assignee_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Composite tenant-integrity foreign keys (see tenant_integrity_and_rls's
--    header comment for the full mechanism: this makes it impossible for a
--    row to reference a lead source/service/membership belonging to a
--    different organization). `assignee_membership_ids` (an array) has no
--    equivalent -- Postgres can't FK individual array elements -- so that
--    one is validated only in the application layer
--    (websiteLeadAssignmentRuleService.ts).
-- ---------------------------------------------------------------------------

ALTER TABLE "website_lead_assignment_rules"
  ADD CONSTRAINT "website_lead_assignment_rules_org_lead_source_fk"
  FOREIGN KEY ("organization_id", "lead_source_id")
  REFERENCES "lead_sources" ("organization_id", "id");

ALTER TABLE "website_lead_assignment_rules"
  ADD CONSTRAINT "website_lead_assignment_rules_org_service_fk"
  FOREIGN KEY ("organization_id", "service_id")
  REFERENCES "services" ("organization_id", "id");

ALTER TABLE "website_lead_assignment_rules"
  ADD CONSTRAINT "website_lead_assignment_rules_org_assignee_membership_fk"
  FOREIGN KEY ("organization_id", "assignee_membership_id")
  REFERENCES "memberships" ("organization_id", "id");

-- ---------------------------------------------------------------------------
-- 3. Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE "website_lead_assignment_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "website_lead_assignment_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "website_lead_assignment_rules"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

-- Table privileges for the least-privilege `figbloom_app` role are already
-- covered by `tenant_integrity_and_rls`'s `ALTER DEFAULT PRIVILEGES ... GRANT
-- SELECT, INSERT, UPDATE, DELETE ON TABLES TO figbloom_app`, which applies to
-- every table created afterward by the same migration user -- no additional
-- GRANT needed here (same note as `website_lead_capture`'s migration).
