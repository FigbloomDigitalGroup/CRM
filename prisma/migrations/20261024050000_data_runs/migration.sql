-- FIG-1034 (B2.05): import and export runs.
--
-- One row per import or export a person starts. The work itself is a background
-- job (B2.18); this row is what the person watches: status, progress, counts,
-- the source file (imports), the result and the error report (both stored
-- through the file service), and a cancel request the job checks as it goes.

CREATE TYPE "DataRunKind" AS ENUM ('IMPORT', 'EXPORT');
CREATE TYPE "DataRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED');

CREATE TABLE "data_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "kind" "DataRunKind" NOT NULL,
    -- LEAD, CONTACT, COMPANY or DEAL.
    "entity" TEXT NOT NULL,
    "status" "DataRunStatus" NOT NULL DEFAULT 'QUEUED',
    "created_by_membership_id" TEXT,
    "source_file_id" TEXT,
    "result_file_id" TEXT,
    "error_file_id" TEXT,
    -- Mapping and duplicate strategy for an import; the filters for an export.
    "params" JSONB NOT NULL DEFAULT '{}',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "processed_rows" INTEGER NOT NULL DEFAULT 0,
    "created_rows" INTEGER NOT NULL DEFAULT 0,
    "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
    "already_converted_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
    "failure_message" TEXT,
    "job_id" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "data_runs_organization_id_id_key" ON "data_runs"("organization_id", "id");
CREATE INDEX "data_runs_org_created_idx" ON "data_runs"("organization_id", "created_at" DESC);

ALTER TABLE "data_runs"
  ADD CONSTRAINT "data_runs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_runs" ADD CONSTRAINT "data_runs_org_created_by_fk"
  FOREIGN KEY ("organization_id", "created_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("created_by_membership_id");

ALTER TABLE "data_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "data_runs"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
