-- FIG-1152 (B6.20): the Ask Figbloom assistant backend.
--
--   assistant_requests   one row per question that reached (or was refused before reaching) the provider: the audit trail
--                        and the usage count for the per-person and per-organisation daily limits
--   assistant_proposals  what the assistant suggested doing. Nothing runs until the person confirms; a confirmed proposal
--                        goes through the same service, with the same permission checks, as if the person had done it
--
-- The organisation switch is the existing `assistant.enabled` feature toggle (off by default); options and limits are the
-- organisation setting `assistant.config`.

CREATE TABLE "assistant_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "basis" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "context_counts" JSONB NOT NULL DEFAULT '{}',
    "injection_flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "redactions" INTEGER NOT NULL DEFAULT 0,
    "record_kind" TEXT,
    "record_id" TEXT,
    "feedback" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assistant_requests_status_chk" CHECK ("status" IN ('ANSWERED', 'ERROR')),
    CONSTRAINT "assistant_requests_feedback_chk" CHECK ("feedback" IS NULL OR "feedback" IN ('up', 'down'))
);
CREATE UNIQUE INDEX "assistant_requests_org_id_key" ON "assistant_requests"("organization_id", "id");
CREATE INDEX "assistant_requests_org_member_day_idx" ON "assistant_requests"("organization_id", "membership_id", "created_at" DESC);
CREATE INDEX "assistant_requests_org_day_idx" ON "assistant_requests"("organization_id", "created_at" DESC);
ALTER TABLE "assistant_requests" ADD CONSTRAINT "assistant_requests_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assistant_requests" ADD CONSTRAINT "assistant_requests_org_member_fk"
  FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;

CREATE TABLE "assistant_proposals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3),
    "failure" TEXT,
    "result_entity_type" TEXT,
    "result_entity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_proposals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assistant_proposals_kind_chk" CHECK ("kind" IN ('CREATE_TASK')),
    CONSTRAINT "assistant_proposals_status_chk" CHECK ("status" IN ('PENDING', 'CONFIRMED', 'DISMISSED', 'FAILED'))
);
CREATE INDEX "assistant_proposals_org_member_idx" ON "assistant_proposals"("organization_id", "membership_id", "status");
CREATE INDEX "assistant_proposals_request_idx" ON "assistant_proposals"("organization_id", "request_id");
ALTER TABLE "assistant_proposals" ADD CONSTRAINT "assistant_proposals_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assistant_proposals" ADD CONSTRAINT "assistant_proposals_org_member_fk"
  FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "assistant_proposals" ADD CONSTRAINT "assistant_proposals_org_request_fk"
  FOREIGN KEY ("organization_id", "request_id") REFERENCES "assistant_requests" ("organization_id", "id") ON DELETE CASCADE;

ALTER TABLE "assistant_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assistant_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "assistant_requests"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "assistant_proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assistant_proposals" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "assistant_proposals"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
