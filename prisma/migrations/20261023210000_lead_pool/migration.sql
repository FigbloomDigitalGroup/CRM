-- FIG-1031 (B2.02): the shared pool of unassigned leads and "Ask to take".
--
-- A request says who wants which unassigned lead. At most one request per
-- person per lead is pending at a time. Approving (or the automatic mode)
-- gives the lead to the requester with a conditional update, so two people
-- asking for the same lead at once cannot both get it.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LEAD_POOL';

CREATE TYPE "LeadPoolRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED', 'SUPERSEDED');

CREATE TABLE "lead_pool_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "requester_membership_id" TEXT NOT NULL,
    "status" "LeadPoolRequestStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "decision_reason" TEXT,
    "decided_by_membership_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_pool_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_pool_requests_one_pending_key"
  ON "lead_pool_requests"("lead_id", "requester_membership_id") WHERE "status" = 'PENDING';
CREATE INDEX "lead_pool_requests_org_status_idx" ON "lead_pool_requests"("organization_id", "status", "created_at");
CREATE INDEX "lead_pool_requests_lead_idx" ON "lead_pool_requests"("lead_id");
CREATE INDEX "lead_pool_requests_requester_idx" ON "lead_pool_requests"("organization_id", "requester_membership_id", "created_at");

ALTER TABLE "lead_pool_requests"
  ADD CONSTRAINT "lead_pool_requests_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_pool_requests" ADD CONSTRAINT "lead_pool_requests_org_lead_fk"
  FOREIGN KEY ("organization_id", "lead_id") REFERENCES "leads" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "lead_pool_requests" ADD CONSTRAINT "lead_pool_requests_org_requester_fk"
  FOREIGN KEY ("organization_id", "requester_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "lead_pool_requests" ADD CONSTRAINT "lead_pool_requests_org_decided_by_fk"
  FOREIGN KEY ("organization_id", "decided_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("decided_by_membership_id");

ALTER TABLE "lead_pool_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_pool_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "lead_pool_requests"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
