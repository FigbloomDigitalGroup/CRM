-- FIG-1185 (B7.03): platform announcements, targeted at organisations, and each member's dismissals.
-- platform_announcements belongs to the platform (no organisation id: the target list is data of the platform's, not a tenant's). Its walls
-- are the same as the other platform console tables: RLS forced, a policy for figbloom_platform only, no privilege for the tenant role
-- (scripts/db-admin.ts). The tenant feed reads it through the schema-owner client with the organisation id in the query.
-- announcement_dismissals is a tenant table: RLS on the organisation, one row per member and announcement.

CREATE TABLE "platform_announcements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'MAINTENANCE',
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "target_all" BOOLEAN NOT NULL DEFAULT false,
    "target_organization_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "dismiss_rule" TEXT NOT NULL DEFAULT 'PERMANENT',
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_label" TEXT,
    "created_by_identity_id" TEXT,
    "created_by_label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_announcements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_announcements_kind_check" CHECK ("kind" IN ('MAINTENANCE', 'NEW_FEATURE', 'INCIDENT')),
    CONSTRAINT "platform_announcements_severity_check" CHECK ("severity" IN ('INFO', 'WARNING', 'CRITICAL')),
    CONSTRAINT "platform_announcements_dismiss_rule_check" CHECK ("dismiss_rule" IN ('PERMANENT', 'DAILY', 'NOT_DISMISSIBLE')),
    CONSTRAINT "platform_announcements_window_check" CHECK ("ends_at" > "starts_at"),
    CONSTRAINT "platform_announcements_title_check" CHECK (char_length(btrim("title")) BETWEEN 1 AND 120),
    CONSTRAINT "platform_announcements_body_check" CHECK (char_length(btrim("body")) BETWEEN 1 AND 1000),
    CONSTRAINT "platform_announcements_target_check" CHECK ("target_all" OR cardinality("target_organization_ids") > 0)
);

CREATE INDEX "platform_announcements_window_idx" ON "platform_announcements"("starts_at", "ends_at");

CREATE TABLE "announcement_dismissals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "announcement_id" TEXT NOT NULL,
    "dismissed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_dismissals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "announcement_dismissals_membership_id_announcement_id_key" ON "announcement_dismissals"("membership_id", "announcement_id");
CREATE INDEX "announcement_dismissals_organization_id_idx" ON "announcement_dismissals"("organization_id");

ALTER TABLE "announcement_dismissals"
  ADD CONSTRAINT "announcement_dismissals_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "announcement_dismissals"
  ADD CONSTRAINT "announcement_dismissals_org_membership_fk"
  FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "announcement_dismissals"
  ADD CONSTRAINT "announcement_dismissals_announcement_id_fkey"
  FOREIGN KEY ("announcement_id") REFERENCES "platform_announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "announcement_dismissals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "announcement_dismissals" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "announcement_dismissals"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "platform_announcements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_announcements" FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_access ON "platform_announcements" FOR ALL TO figbloom_platform USING (true) WITH CHECK (true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'figbloom_app') THEN
    EXECUTE 'REVOKE ALL ON "platform_announcements" FROM figbloom_app';
  END IF;
END
$$;
