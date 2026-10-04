-- FIG-599: services become reorderable like the other 4 reference-data
-- catalogs (LeadSource, LeadStatus, PipelineStage, LostReason all already
-- have `sequence`). Backfill existing rows with a stable per-organization
-- ordering (creation order) instead of leaving every row at the column
-- default 0, so the reorder UI doesn't start with a meaningless tie.
ALTER TABLE "services" ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY organization_id ORDER BY created_at ASC, id ASC
  ) AS rn
  FROM services
)
UPDATE services s
SET sequence = ranked.rn
FROM ranked
WHERE ranked.id = s.id;
