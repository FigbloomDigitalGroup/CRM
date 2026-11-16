-- P2-22 (FIG-1676): calls and meetings added from the Calendar are tasks, so the Calendar and the Tasks page read one table.
-- Additive only (expand step): a type column with a default, and a nullable link to the activity a task came from. Safe to repeat.
DO $$ BEGIN
  CREATE TYPE "TaskType" AS ENUM ('TASK', 'CALL', 'MEETING', 'EMAIL', 'QUOTE', 'VISIT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "type" "TaskType" NOT NULL DEFAULT 'TASK';
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "source_activity_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_activity_id_fkey"
    FOREIGN KEY ("source_activity_id") REFERENCES "activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One task per source activity: a retry or a repeated backfill can never make a second one.
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_source_activity_id_key" ON "tasks" ("source_activity_id") WHERE "source_activity_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "tasks_organization_id_type_idx" ON "tasks" ("organization_id", "type");
