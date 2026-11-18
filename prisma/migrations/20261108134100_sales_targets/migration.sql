-- FIG-1146 (B6.14): monthly sales targets, per person and for the team (membership_id NULL).
-- Hand-written, same reasoning as the other composite tenant foreign keys.

CREATE TABLE "sales_targets" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT,
    "period_start" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "set_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_targets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_targets_amount_check" CHECK ("amount" >= 0),
    CONSTRAINT "sales_targets_period_check" CHECK (EXTRACT(DAY FROM "period_start") = 1)
);

CREATE UNIQUE INDEX "sales_targets_person_period_key" ON "sales_targets"("organization_id", "membership_id", "period_start") WHERE "membership_id" IS NOT NULL;
CREATE UNIQUE INDEX "sales_targets_team_period_key" ON "sales_targets"("organization_id", "period_start") WHERE "membership_id" IS NULL;
CREATE INDEX "sales_targets_organization_id_period_start_idx" ON "sales_targets"("organization_id", "period_start");

ALTER TABLE "sales_targets"
  ADD CONSTRAINT "sales_targets_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales_targets"
  ADD CONSTRAINT "sales_targets_org_membership_fk"
  FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "sales_targets"
  ADD CONSTRAINT "sales_targets_org_set_by_fk"
  FOREIGN KEY ("organization_id", "set_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("set_by_membership_id");

ALTER TABLE "sales_targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales_targets" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sales_targets"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
