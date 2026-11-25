-- UC-C5 step 3 (FIG-1790): per-member permission overrides. Management can ADD (GRANT) or REMOVE (DENY) single permission keys for one
-- member on top of the member's role. Effective keys = role keys + GRANT - DENY (see src/auth/permissions.ts, docs/MEMBER_ACCESS_OVERRIDES.md).
-- Additive: a new tenant table, nothing existing is changed.

CREATE TABLE "membership_permission_overrides" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "permission_key" TEXT NOT NULL,
    "effect" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_permission_overrides_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "membership_permission_overrides_effect_chk" CHECK ("effect" IN ('GRANT', 'DENY'))
);
CREATE UNIQUE INDEX "membership_permission_overrides_membership_id_permission_key_key"
  ON "membership_permission_overrides"("membership_id", "permission_key");
CREATE INDEX "membership_permission_overrides_organization_id_idx" ON "membership_permission_overrides"("organization_id");
ALTER TABLE "membership_permission_overrides" ADD CONSTRAINT "membership_permission_overrides_org_membership_fk"
  FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "membership_permission_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership_permission_overrides" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "membership_permission_overrides"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
