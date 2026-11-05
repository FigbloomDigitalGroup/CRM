-- FIG-1148 (B6.16): saved views, personal and shared, pinned per person in the sidebar.
-- Hand-written, same reasoning as the other composite tenant foreign keys.

CREATE TABLE "saved_views" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "owner_membership_id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'PERSONAL',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "sort" JSONB,
    "columns" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "saved_views_scope_check" CHECK ("scope" IN ('PERSONAL', 'SHARED')),
    CONSTRAINT "saved_views_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 40)
);

CREATE UNIQUE INDEX "saved_views_organization_id_id_key" ON "saved_views"("organization_id", "id");
CREATE UNIQUE INDEX "saved_views_owner_entity_name_key" ON "saved_views"("organization_id", "owner_membership_id", "entity", lower("name"));
CREATE INDEX "saved_views_organization_id_entity_idx" ON "saved_views"("organization_id", "entity");

ALTER TABLE "saved_views"
  ADD CONSTRAINT "saved_views_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_views"
  ADD CONSTRAINT "saved_views_org_owner_fk"
  FOREIGN KEY ("organization_id", "owner_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;

CREATE TABLE "saved_view_pins" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "saved_view_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_view_pins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "saved_view_pins_membership_id_saved_view_id_key" ON "saved_view_pins"("membership_id", "saved_view_id");
CREATE INDEX "saved_view_pins_organization_id_membership_id_idx" ON "saved_view_pins"("organization_id", "membership_id");

ALTER TABLE "saved_view_pins"
  ADD CONSTRAINT "saved_view_pins_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_view_pins"
  ADD CONSTRAINT "saved_view_pins_org_membership_fk"
  FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "saved_view_pins"
  ADD CONSTRAINT "saved_view_pins_org_view_fk"
  FOREIGN KEY ("organization_id", "saved_view_id") REFERENCES "saved_views" ("organization_id", "id") ON DELETE CASCADE;

ALTER TABLE "saved_views" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_views" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "saved_views"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "saved_view_pins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_view_pins" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "saved_view_pins"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
