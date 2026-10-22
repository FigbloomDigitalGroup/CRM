-- FIG-792: deal_handoffs table and the DEAL_WON_HANDOFF notification type.
--
-- Prisma's auto-generated diff for this migration would also propose
-- DROPPING every hand-written composite tenant-integrity foreign key (they
-- exist only in the database, not in schema.prisma; see
-- `tenant_integrity_and_rls`'s header comment). That diff was discarded; this
-- file only adds what FIG-792 needs, using the same hand-written pattern as
-- `page_views` for the composite FKs and the RLS policy.

-- ---------------------------------------------------------------------------
-- 1. New notification type. Not used inside this migration, so it is safe in
--    the migration's transaction.
-- ---------------------------------------------------------------------------

ALTER TYPE "NotificationType" ADD VALUE 'DEAL_WON_HANDOFF';

-- ---------------------------------------------------------------------------
-- 2. Table. One row per deal: the unique deal_id is the idempotency marker
--    that stops a re-opened and re-won deal getting a second set of tasks.
-- ---------------------------------------------------------------------------

CREATE TABLE "deal_handoffs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "delivery_owner_membership_id" TEXT NOT NULL,
    "created_by_membership_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_handoffs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "deal_handoffs_deal_id_key" ON "deal_handoffs"("deal_id");

CREATE INDEX "deal_handoffs_organization_id_idx" ON "deal_handoffs"("organization_id");

CREATE INDEX "deal_handoffs_organization_id_delivery_owner_membership_id_idx" ON "deal_handoffs"("organization_id", "delivery_owner_membership_id");

ALTER TABLE "deal_handoffs" ADD CONSTRAINT "deal_handoffs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "deal_handoffs" ADD CONSTRAINT "deal_handoffs_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Composite tenant-integrity foreign keys: a handoff can only reference a
--    deal and memberships of its own organization.
-- ---------------------------------------------------------------------------

ALTER TABLE "deal_handoffs"
  ADD CONSTRAINT "deal_handoffs_org_deal_fk"
  FOREIGN KEY ("organization_id", "deal_id")
  REFERENCES "deals" ("organization_id", "id");

ALTER TABLE "deal_handoffs"
  ADD CONSTRAINT "deal_handoffs_org_delivery_owner_fk"
  FOREIGN KEY ("organization_id", "delivery_owner_membership_id")
  REFERENCES "memberships" ("organization_id", "id");

ALTER TABLE "deal_handoffs"
  ADD CONSTRAINT "deal_handoffs_org_created_by_fk"
  FOREIGN KEY ("organization_id", "created_by_membership_id")
  REFERENCES "memberships" ("organization_id", "id");

-- ---------------------------------------------------------------------------
-- 4. Row-level security
-- ---------------------------------------------------------------------------

ALTER TABLE "deal_handoffs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal_handoffs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deal_handoffs"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

-- Table privileges for `figbloom_app` come from `tenant_integrity_and_rls`'s
-- default privileges, as for page_views and every table since.
