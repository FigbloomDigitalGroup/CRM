-- FIG-1184 (B7.02): usage counters per organisation (operational counts only).
-- One row per organisation, metric and period (the first day of the month for API calls). The platform console reads these as numbers
-- only; nothing here describes a record. Rows are written by the schema-owner client when a counted action happens (an API call).

CREATE TABLE "organization_usage_counters" (
    "organization_id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "count" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_usage_counters_pkey" PRIMARY KEY ("organization_id", "metric", "period_start"),
    CONSTRAINT "organization_usage_counters_metric_check" CHECK ("metric" IN ('API_CALLS')),
    CONSTRAINT "organization_usage_counters_count_check" CHECK ("count" >= 0)
);

ALTER TABLE "organization_usage_counters"
  ADD CONSTRAINT "organization_usage_counters_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "organization_usage_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_usage_counters" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "organization_usage_counters"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
