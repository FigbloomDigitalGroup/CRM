-- FIG-1035 (B2.06): deal rules.
--
-- * `pipeline_stages.stalled_after_days`: a stage can have its own stalled
--   threshold; null means the organisation default (10 days).
-- * `deals.last_activity_at`: when anything last happened on the deal (an
--   activity, an email, a stage move). "Stalled" is derived from it, so a
--   list never has to join activities to flag a deal.
-- * `deal_moves`: every stage move, so it can be undone for a short period.

ALTER TABLE "pipeline_stages" ADD COLUMN "stalled_after_days" INTEGER;
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_stalled_days_check"
  CHECK ("stalled_after_days" IS NULL OR "stalled_after_days" BETWEEN 1 AND 365);

ALTER TABLE "deals" ADD COLUMN "last_activity_at" TIMESTAMP(3);
UPDATE "deals" d SET "last_activity_at" = GREATEST(
  d."updated_at",
  COALESCE((SELECT max(a."occurred_at") FROM "activities" a WHERE a."deal_id" = d."id"), d."created_at"),
  COALESCE((SELECT max(c."occurred_at") FROM "communications" c WHERE c."deal_id" = d."id"), d."created_at")
);
ALTER TABLE "deals" ALTER COLUMN "last_activity_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "deals" ALTER COLUMN "last_activity_at" SET NOT NULL;
CREATE INDEX "deals_organization_id_last_activity_at_idx" ON "deals"("organization_id", "last_activity_at");

CREATE TABLE "deal_moves" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "from_stage_id" TEXT NOT NULL,
    "to_stage_id" TEXT NOT NULL,
    "moved_by_membership_id" TEXT,
    "moved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undo_expires_at" TIMESTAMP(3) NOT NULL,
    "undone_at" TIMESTAMP(3),
    -- The outcome fields before the move, so an undo restores them exactly.
    "previous" JSONB NOT NULL,

    CONSTRAINT "deal_moves_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "deal_moves_org_deal_idx" ON "deal_moves"("organization_id", "deal_id", "moved_at");

ALTER TABLE "deal_moves"
  ADD CONSTRAINT "deal_moves_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deal_moves" ADD CONSTRAINT "deal_moves_org_deal_fk"
  FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "deal_moves" ADD CONSTRAINT "deal_moves_org_moved_by_fk"
  FOREIGN KEY ("organization_id", "moved_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("moved_by_membership_id");

ALTER TABLE "deal_moves" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal_moves" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deal_moves"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
