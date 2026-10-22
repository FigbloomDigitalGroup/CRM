-- FIG-1014 (B0.06): idempotency_keys, so a create endpoint that is retried
-- (mobile, offline sync, a flaky network) with the same Idempotency-Key does
-- not create the record twice.
--
-- Hand-written, same pattern as `deal_handoffs`: Prisma's auto-diff would
-- also propose dropping the hand-written composite tenant foreign keys, so
-- this file only adds what B0.06 needs.

CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- One key is one request, per person per organization.
CREATE UNIQUE INDEX "idempotency_keys_org_member_key_key"
  ON "idempotency_keys"("organization_id", "membership_id", "key");

-- Old keys are purged by age.
CREATE INDEX "idempotency_keys_organization_id_created_at_idx"
  ON "idempotency_keys"("organization_id", "created_at");

ALTER TABLE "idempotency_keys"
  ADD CONSTRAINT "idempotency_keys_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- A key can only belong to a membership of its own organization.
ALTER TABLE "idempotency_keys"
  ADD CONSTRAINT "idempotency_keys_org_membership_fk"
  FOREIGN KEY ("organization_id", "membership_id")
  REFERENCES "memberships" ("organization_id", "id")
  ON DELETE CASCADE;

ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "idempotency_keys"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
