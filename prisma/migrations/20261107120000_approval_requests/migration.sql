-- FIG-1145 (B6.13): the approvals engine.
--
-- One table for requests that wait for a person: a quote discount above the limit, a deal worth more than the limit being marked
-- won, a stage rule that needs approval. Export approvals and erasure confirmations keep their own tables (B4.05) and are listed
-- in the same inbox by the service. A request is decided once: the guard below refuses a second decision, and a rejection must
-- carry a reason that the requester can read.

CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "deal_id" TEXT,
    "title" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "requested_by_membership_id" TEXT,
    "requester_note" TEXT,
    "decided_by_membership_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_reason" TEXT,
    "expires_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "resumed_at" TIMESTAMP(3),
    "resume_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "approval_requests_kind_check" CHECK ("kind" IN ('DISCOUNT', 'LARGE_DEAL')),
    CONSTRAINT "approval_requests_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    CONSTRAINT "approval_requests_rejection_reason_check" CHECK ("status" <> 'REJECTED' OR char_length(btrim(coalesce("decision_reason", ''))) >= 3),
    CONSTRAINT "approval_requests_decided_check" CHECK ("status" = 'PENDING' OR "decided_at" IS NOT NULL)
);

CREATE UNIQUE INDEX "approval_requests_organization_id_id_key" ON "approval_requests"("organization_id", "id");
-- One open request per subject: asking twice returns the first, it does not pile up.
CREATE UNIQUE INDEX "approval_requests_one_pending_key" ON "approval_requests"("organization_id", "kind", "subject_type", "subject_id") WHERE "status" = 'PENDING';
CREATE INDEX "approval_requests_organization_id_status_idx" ON "approval_requests"("organization_id", "status");
CREATE INDEX "approval_requests_org_requested_by_idx" ON "approval_requests"("organization_id", "requested_by_membership_id");

ALTER TABLE "approval_requests"
  ADD CONSTRAINT "approval_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "approval_requests"
  ADD CONSTRAINT "approval_requests_org_deal_fk" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "approval_requests"
  ADD CONSTRAINT "approval_requests_org_requested_by_fk" FOREIGN KEY ("organization_id", "requested_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("requested_by_membership_id");
ALTER TABLE "approval_requests"
  ADD CONSTRAINT "approval_requests_org_decided_by_fk" FOREIGN KEY ("organization_id", "decided_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("decided_by_membership_id");

ALTER TABLE "approval_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "approval_requests"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

-- A decision is final: once a request is APPROVED, REJECTED or CANCELLED its decision cannot be rewritten. Only the bookkeeping
-- of using an approved grant (consumed_at, resumed_at, resume_error, updated_at) may still change.
CREATE FUNCTION approval_requests_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'PENDING' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.subject_type IS DISTINCT FROM OLD.subject_type
       OR NEW.subject_id IS DISTINCT FROM OLD.subject_id
       OR (NEW.decided_by_membership_id IS DISTINCT FROM OLD.decided_by_membership_id AND NEW.decided_by_membership_id IS NOT NULL)
       OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
       OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason
       OR (NEW.requested_by_membership_id IS DISTINCT FROM OLD.requested_by_membership_id AND NEW.requested_by_membership_id IS NOT NULL) THEN
      RAISE EXCEPTION 'An approval request that was decided cannot be changed.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER approval_requests_guard BEFORE UPDATE ON "approval_requests"
  FOR EACH ROW EXECUTE FUNCTION approval_requests_guard();
