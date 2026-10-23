-- FIG-1032 (B2.03): the stored lead score and customer health.
--
-- Computed by rules (src/lib/scoring.ts) when something relevant happens to the
-- record and again nightly, and stored with the factors that explain it, so a
-- list can show and sort by it without recomputing.

ALTER TABLE "leads"
  ADD COLUMN "score_value" INTEGER,
  ADD COLUMN "score_band" TEXT,
  ADD COLUMN "score_factors" JSONB,
  ADD COLUMN "scored_at" TIMESTAMP(3);
ALTER TABLE "companies"
  ADD COLUMN "health_value" INTEGER,
  ADD COLUMN "health_band" TEXT,
  ADD COLUMN "health_factors" JSONB,
  ADD COLUMN "health_scored_at" TIMESTAMP(3);

CREATE INDEX "leads_organization_id_score_value_idx" ON "leads"("organization_id", "score_value");
CREATE INDEX "companies_organization_id_health_value_idx" ON "companies"("organization_id", "health_value");
