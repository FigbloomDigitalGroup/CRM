-- P2-15 (FIG-1598) Team page: open leads per owner and quiet-lead checks read only open leads, so index just those.
-- Partial and covering (created_at and last_contacted_at are read from the index). Additive and safe to repeat.
CREATE INDEX IF NOT EXISTS "leads_open_owner_covering_idx"
  ON "leads" ("organization_id", "owner_membership_id") INCLUDE ("created_at", "last_contacted_at")
  WHERE "archived_at" IS NULL AND "converted_at" IS NULL AND "lost_reason_id" IS NULL;
