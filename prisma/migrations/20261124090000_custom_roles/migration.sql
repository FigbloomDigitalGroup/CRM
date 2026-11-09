-- FIG-1188 (B7.06): roles and field access editor.
--
-- A custom role is a row of "roles" that belongs to one organisation (organization_id), with its permissions in the existing
-- "role_permissions". The five platform roles keep organization_id NULL and are untouched. Row-level security shows a custom role
-- (and its permission rows) to its own organisation only; the platform roles stay visible to every organisation.

ALTER TABLE "roles" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "roles" ADD COLUMN "based_on_role_key" TEXT;
ALTER TABLE "roles" ADD COLUMN "archived_at" TIMESTAMP(3);
ALTER TABLE "roles" ADD COLUMN "created_by_membership_id" TEXT;

ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A custom role is never a system role, and a system role never belongs to an organisation.
ALTER TABLE "roles" ADD CONSTRAINT "roles_custom_not_system_chk" CHECK ("organization_id" IS NULL OR "is_system" = false);
CREATE UNIQUE INDEX "roles_org_id_key" ON "roles"("organization_id", "id");
-- One live custom role name per organisation, whatever the capitals.
CREATE UNIQUE INDEX "roles_org_live_name_key" ON "roles"("organization_id", lower("name"))
  WHERE "organization_id" IS NOT NULL AND "archived_at" IS NULL;

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "roles"
  USING ("organization_id" IS NULL OR "organization_id" = current_setting('app.current_organization_id', true))
  WITH CHECK ("organization_id" = current_setting('app.current_organization_id', true));

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_visible ON "role_permissions"
  USING (EXISTS (SELECT 1 FROM "roles" r WHERE r."id" = "role_id"))
  WITH CHECK (EXISTS (SELECT 1 FROM "roles" r WHERE r."id" = "role_id" AND r."organization_id" IS NOT NULL));

CREATE TABLE "role_field_rules" (
    "role_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "access" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_field_rules_pkey" PRIMARY KEY ("role_id", "field"),
    CONSTRAINT "role_field_rules_field_chk" CHECK ("field" IN ('deal.value')),
    CONSTRAINT "role_field_rules_access_chk" CHECK ("access" IN ('all', 'own', 'hidden'))
);
CREATE INDEX "role_field_rules_organization_id_idx" ON "role_field_rules"("organization_id");
ALTER TABLE "role_field_rules" ADD CONSTRAINT "role_field_rules_org_role_fk"
  FOREIGN KEY ("organization_id", "role_id") REFERENCES "roles" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "role_field_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_field_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "role_field_rules"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
