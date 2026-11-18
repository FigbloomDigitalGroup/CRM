-- FIG-1066 (B2.18): the one background job system. Imports, lifecycle
-- detection, reminders, retention purges and the notification sweep all run
-- as rows in this table, so a crashed worker never loses a job and the status
-- API (and later the platform health page) has one place to read.
--
-- Hand-written, same pattern as `files` and `deal_handoffs`: Prisma's
-- auto-diff would also propose dropping the hand-written composite tenant
-- foreign keys, so this file only adds what B2.18 needs.

CREATE TYPE "BackgroundJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'DEAD', 'CANCELLED');

CREATE TABLE "background_jobs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "BackgroundJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timeout_ms" INTEGER NOT NULL DEFAULT 300000,
    -- Set while a worker holds the job. The lease is extended by nothing: a
    -- worker that dies simply lets it expire and the job is picked up again.
    "locked_by" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "last_error" TEXT,
    "result" JSONB,
    -- Scheduled jobs carry "<type>:<slot>" here, so two schedulers ticking at
    -- once enqueue a slot exactly once. Null for on-demand jobs.
    "dedupe_key" TEXT,
    "request_id" TEXT,
    "created_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "background_jobs_attempts_check" CHECK ("attempts" >= 0 AND "max_attempts" >= 1)
);

CREATE UNIQUE INDEX "background_jobs_org_dedupe_key" ON "background_jobs"("organization_id", "dedupe_key");
CREATE INDEX "background_jobs_claim_idx" ON "background_jobs"("status", "run_at");
CREATE INDEX "background_jobs_org_status_idx" ON "background_jobs"("organization_id", "status", "created_at");
CREATE INDEX "background_jobs_org_type_idx" ON "background_jobs"("organization_id", "type", "created_at");

ALTER TABLE "background_jobs"
  ADD CONSTRAINT "background_jobs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "background_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "background_jobs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "background_jobs"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
