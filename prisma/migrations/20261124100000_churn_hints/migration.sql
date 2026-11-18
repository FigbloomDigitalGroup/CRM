-- FIG-1190 (B7.08): churn hints from the assistant. One row per hint for a company; the reasons (with the permission needed to see each)
-- are in "signals". A hint is OPEN until a person dismisses it or the signals clear (RESOLVED). Never holds money.

CREATE TABLE "churn_hints" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "owner_membership_id" TEXT,
    "score" INTEGER NOT NULL,
    "signals" JSONB NOT NULL,
    "signals_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "dismissed_by_membership_id" TEXT,
    "dismiss_reason" TEXT,
    "feedback" TEXT,
    "feedback_note" TEXT,
    "feedback_by_membership_id" TEXT,
    "feedback_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "churn_hints_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "churn_hints_status_chk" CHECK ("status" IN ('OPEN', 'DISMISSED', 'RESOLVED')),
    CONSTRAINT "churn_hints_feedback_chk" CHECK ("feedback" IS NULL OR "feedback" IN ('HELPFUL', 'NOT_HELPFUL')),
    CONSTRAINT "churn_hints_score_chk" CHECK ("score" >= 0)
);
CREATE INDEX "churn_hints_organization_id_status_idx" ON "churn_hints"("organization_id", "status");
CREATE INDEX "churn_hints_organization_id_company_id_idx" ON "churn_hints"("organization_id", "company_id");
-- At most one open hint per company.
CREATE UNIQUE INDEX "churn_hints_one_open_key" ON "churn_hints"("organization_id", "company_id") WHERE "status" = 'OPEN';

ALTER TABLE "churn_hints" ADD CONSTRAINT "churn_hints_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "churn_hints" ADD CONSTRAINT "churn_hints_org_company_fk"
  FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies" ("organization_id", "id") ON DELETE CASCADE;

ALTER TABLE "churn_hints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "churn_hints" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "churn_hints"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
