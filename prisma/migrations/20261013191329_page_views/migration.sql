-- FIG-752: page_views table.
--
-- Prisma's auto-generated diff for this migration also proposed DROPPING
-- every composite tenant-integrity foreign key added by the earlier
-- hand-written `tenant_integrity_and_rls` migration, because those
-- constraints exist only in the database, not in schema.prisma (see that
-- migration's own header comment for why they're hand-written, and
-- `website_lead_capture`/`website_lead_assignment_rules`'s headers for the
-- same discard). That diff was discarded; this file only adds what FIG-752
-- actually needs, using the exact same hand-written pattern for the new
-- table's composite FK and RLS policy.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

CREATE TABLE "page_views" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "page_views_organization_id_page_viewed_at_idx" ON "page_views"("organization_id", "page", "viewed_at");

CREATE INDEX "page_views_organization_id_membership_id_viewed_at_idx" ON "page_views"("organization_id", "membership_id", "viewed_at");

ALTER TABLE "page_views" ADD CONSTRAINT "page_views_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "page_views" ADD CONSTRAINT "page_views_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Composite tenant-integrity foreign key (see tenant_integrity_and_rls's
--    header comment for the full mechanism: this makes it impossible for a
--    row to reference a membership belonging to a different organization).
-- ---------------------------------------------------------------------------

ALTER TABLE "page_views"
  ADD CONSTRAINT "page_views_org_membership_fk"
  FOREIGN KEY ("organization_id", "membership_id")
  REFERENCES "memberships" ("organization_id", "id");

-- ---------------------------------------------------------------------------
-- 3. Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE "page_views" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "page_views" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "page_views"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

-- Table privileges for the least-privilege `figbloom_app` role are already
-- covered by `tenant_integrity_and_rls`'s `ALTER DEFAULT PRIVILEGES ... GRANT
-- SELECT, INSERT, UPDATE, DELETE ON TABLES TO figbloom_app`, which applies to
-- every table created afterward by the same migration user -- no additional
-- GRANT needed here (same note as `website_lead_capture`'s migration).

-- No UPDATE/DELETE grant restriction added here (unlike audit_events'
-- append-only treatment) -- page views have no edit/delete UI or API at
-- all, so there's nothing in the app that could misuse broader privileges;
-- keeping the same default grants as every other table avoids a special
-- case with no corresponding feature to justify it.
