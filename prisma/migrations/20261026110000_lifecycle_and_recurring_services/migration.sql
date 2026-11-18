-- FIG-1048 (B3.02) lifecycle engine, FIG-1051 (B3.05) recurring services and renewals,
-- FIG-795 reminders (one notification per trigger).

-- ---------------------------------------------------------------------------
-- 1. Lifecycle: every transition leaves a row, and a company remembers when it last moved
--    and whether a person set the state by hand (the daily job then leaves it alone).
-- ---------------------------------------------------------------------------

ALTER TABLE "companies"
  ADD COLUMN "lifecycle_changed_at" TIMESTAMP(3),
  ADD COLUMN "lifecycle_manual" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "lifecycle_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "from_state_id" TEXT,
    "to_state_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "actor_membership_id" TEXT,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lifecycle_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lifecycle_events_reason_chk" CHECK ("reason" IN (
      'LEAD_CONVERTED', 'DEAL_WON', 'HANDOFF_DELIVERED', 'DORMANT', 'REACTIVATED',
      'RENEWAL_WINDOW', 'RENEWAL_DONE', 'MANUAL'
    ))
);

CREATE UNIQUE INDEX "lifecycle_events_organization_id_id_key" ON "lifecycle_events"("organization_id", "id");
CREATE INDEX "lifecycle_events_org_company_created_idx" ON "lifecycle_events"("organization_id", "company_id", "created_at" DESC);

ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_org_company_fk" FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_org_to_state_fk" FOREIGN KEY ("organization_id", "to_state_id") REFERENCES "customer_lifecycle_states" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_org_from_state_fk" FOREIGN KEY ("organization_id", "from_state_id") REFERENCES "customer_lifecycle_states" ("organization_id", "id") ON DELETE SET NULL ("from_state_id");
ALTER TABLE "lifecycle_events" ADD CONSTRAINT "lifecycle_events_org_actor_fk" FOREIGN KEY ("organization_id", "actor_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("actor_membership_id");

ALTER TABLE "lifecycle_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lifecycle_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "lifecycle_events"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

-- ---------------------------------------------------------------------------
-- 2. Recurring services (hosting, Starlink plans, retainers) with a renewal date.
--    The renewal state is derived from the dates by rule; `state_override` is a person's
--    explicit decision and always carries a reason.
-- ---------------------------------------------------------------------------

CREATE TYPE "RecurringBillingCycle" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');
CREATE TYPE "RenewalState" AS ENUM ('ACTIVE', 'DUE_SOON', 'LAPSED', 'STARTS_LATER', 'CANCELLED');

CREATE TABLE "recurring_services" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "company_service_id" TEXT,
    "billing_cycle" "RecurringBillingCycle" NOT NULL DEFAULT 'YEARLY',
    "value" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "starts_on" DATE NOT NULL,
    "renews_on" DATE NOT NULL,
    "owner_membership_id" TEXT,
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "state_override" "RenewalState",
    "override_reason" TEXT,
    "last_renewed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_services_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recurring_services_value_chk" CHECK ("value" IS NULL OR "value" >= 0),
    CONSTRAINT "recurring_services_override_reason_chk" CHECK (("state_override" IS NULL) = ("override_reason" IS NULL))
);

CREATE UNIQUE INDEX "recurring_services_organization_id_id_key" ON "recurring_services"("organization_id", "id");
CREATE INDEX "recurring_services_org_renews_on_idx" ON "recurring_services"("organization_id", "renews_on");
CREATE INDEX "recurring_services_org_company_idx" ON "recurring_services"("organization_id", "company_id");
CREATE INDEX "recurring_services_org_owner_idx" ON "recurring_services"("organization_id", "owner_membership_id");

ALTER TABLE "recurring_services" ADD CONSTRAINT "recurring_services_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recurring_services" ADD CONSTRAINT "recurring_services_org_company_fk" FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "recurring_services" ADD CONSTRAINT "recurring_services_org_service_fk" FOREIGN KEY ("organization_id", "service_id") REFERENCES "services" ("organization_id", "id") ON DELETE RESTRICT;
ALTER TABLE "recurring_services" ADD CONSTRAINT "recurring_services_org_owner_fk" FOREIGN KEY ("organization_id", "owner_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("owner_membership_id");
ALTER TABLE "recurring_services" ADD CONSTRAINT "recurring_services_org_created_by_fk" FOREIGN KEY ("organization_id", "created_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("created_by_membership_id");

ALTER TABLE "recurring_services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recurring_services" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "recurring_services"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

-- A renewal invoice points back at the service it renews (the table did not exist when invoices was created).
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_recurring_service_fk" FOREIGN KEY ("organization_id", "recurring_service_id") REFERENCES "recurring_services" ("organization_id", "id") ON DELETE SET NULL ("recurring_service_id");

-- Backfill: a company service that is still running and has an end date becomes a yearly recurring
-- service renewing on that date. Nothing is invented for services without an end date.
INSERT INTO "recurring_services" ("id", "organization_id", "company_id", "service_id", "company_service_id", "billing_cycle", "starts_on", "renews_on", "owner_membership_id", "notes", "updated_at")
SELECT gen_random_uuid()::text, cs."organization_id", cs."company_id", cs."service_id", cs."id", 'YEARLY', COALESCE(cs."start_date", cs."end_date"), cs."end_date", c."owner_membership_id",
       'Created from the company service when recurring services were introduced.', CURRENT_TIMESTAMP
FROM "company_services" cs
JOIN "companies" c ON c."organization_id" = cs."organization_id" AND c."id" = cs."company_id"
WHERE cs."status" = 'ACTIVE' AND cs."end_date" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Reminders: one notification per trigger (FIG-795). The entity id carries the trigger
--    (proposal id and date sent, service id and renewal date), so a repeat run cannot send it twice.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "notifications_reminder_dedup_key" ON "notifications"("organization_id", "membership_id", "type", "entity_type", "entity_id")
  WHERE "type" IN ('RENEWAL_DUE', 'PROPOSAL_UNANSWERED', 'PAYMENT_OVERDUE', 'DORMANT_CUSTOMER');
