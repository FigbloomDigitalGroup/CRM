-- P2-23 (FIG-1677): the lead's open follow-up is one task. Additive only. Safe to repeat.
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "is_follow_up" BOOLEAN NOT NULL DEFAULT false;

-- At most one open (pending or in progress, not archived) follow-up task per lead, so a double click or a retry cannot create a second.
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_one_open_follow_up_per_lead_key"
  ON "tasks" ("organization_id", "lead_id")
  WHERE "is_follow_up" AND "archived_at" IS NULL AND "status" IN ('PENDING', 'IN_PROGRESS');
