-- FIG-783: scheduled_job_runs table -- a single-row-per-job lock/last-run
-- record for recurring background jobs (currently just the notifications
-- due/overdue sweep), so an external cron or multiple replicas triggering
-- the same job can't run it concurrently and double-send.
--
-- Unlike every tenant-scoped table, this one is NOT given row-level
-- security or a composite tenant-integrity foreign key -- it has no
-- organization_id at all, same treatment as `users`/`roles` in the init
-- migration. See the model's own doc comment in schema.prisma.

-- ---------------------------------------------------------------------------
-- 1. Enum
-- ---------------------------------------------------------------------------

CREATE TYPE "ScheduledJobStatus" AS ENUM ('IDLE', 'RUNNING');

-- ---------------------------------------------------------------------------
-- 2. Table
-- ---------------------------------------------------------------------------

CREATE TABLE "scheduled_job_runs" (
    "id" TEXT NOT NULL,
    "job_key" TEXT NOT NULL,
    "status" "ScheduledJobStatus" NOT NULL DEFAULT 'IDLE',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_job_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scheduled_job_runs_job_key_key" ON "scheduled_job_runs"("job_key");

-- Table privileges for the least-privilege `figbloom_app` role are already
-- covered by `tenant_integrity_and_rls`'s `ALTER DEFAULT PRIVILEGES ... GRANT
-- SELECT, INSERT, UPDATE, DELETE ON TABLES TO figbloom_app`, which applies to
-- every table created afterward by the same migration user -- no additional
-- GRANT needed here (same note as `page_views`'s migration).
