-- FIG-1043 (B2.14): materialised dashboard signals.
--
-- One row per organisation holds the last computed adoption, stalled and
-- overdue numbers, so every dashboard and list header reads the same values.
-- They are refreshed nightly by the job framework, whenever the cached values
-- are older than a few minutes and someone asks, and marked stale when a deal
-- or task changes.

CREATE TABLE "signal_snapshots" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signal_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "signal_snapshots_organization_id_key_key" ON "signal_snapshots"("organization_id", "key");

ALTER TABLE "signal_snapshots"
  ADD CONSTRAINT "signal_snapshots_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "signal_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "signal_snapshots" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "signal_snapshots"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
