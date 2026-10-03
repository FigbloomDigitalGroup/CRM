-- FIG-597: in-app notifications, retryable outbound delivery (email now,
-- SMS/WhatsApp architecturally supported but not wired to a real provider
-- yet -- see IMPLEMENTATION_NOTES.md), and per-membership preferences.
--
-- Prisma's auto-generated diff for this migration also proposed DROPPING
-- every composite tenant-integrity foreign key (see the header comment on
-- `tenant_integrity_and_rls` for why those are hand-written and invisible
-- to schema.prisma). That diff was discarded; this file only adds what
-- FIG-597 actually needs, plus the composite FKs and RLS the three new
-- tables need to match every other organization-scoped table.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "NotificationType" AS ENUM ('LEAD_ASSIGNED', 'TASK_DUE', 'TASK_OVERDUE');

CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');

CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'EXHAUSTED');

-- ---------------------------------------------------------------------------
-- 2. notifications
-- ---------------------------------------------------------------------------

CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "link" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_organization_id_membership_id_read_at_idx" ON "notifications"("organization_id", "membership_id", "read_at");

-- Idempotency for the due/overdue generator script ONLY: re-running it
-- must not re-notify the same membership about the same task twice. This
-- is deliberately a PARTIAL index, not a blanket one -- LEAD_ASSIGNED is a
-- directly-triggered, one-shot event per assignment action, and
-- reassigning a lead back to its previous owner is a second real
-- occurrence of the same (membership, entity) pair that must still
-- notify, unlike "this task is due" which only ever becomes true once.
CREATE UNIQUE INDEX "notifications_due_overdue_dedup_key" ON "notifications"("organization_id", "membership_id", "type", "entity_type", "entity_id")
  WHERE "type" IN ('TASK_DUE', 'TASK_OVERDUE');

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Composite tenant-integrity FK, same pattern as every other *_membership_id
-- column in tenant_integrity_and_rls.
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_org_membership_fk"
  FOREIGN KEY ("organization_id", "membership_id")
  REFERENCES "memberships" ("organization_id", "id");

-- ---------------------------------------------------------------------------
-- 3. notification_deliveries
-- ---------------------------------------------------------------------------

CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "notification_id" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "recipient_email" TEXT,
    "recipient_phone" TEXT,
    "template_key" TEXT NOT NULL,
    "payload" JSONB,
    "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- What the retry sweep polls: "give me anything due for another attempt."
CREATE INDEX "notification_deliveries_status_next_attempt_at_idx" ON "notification_deliveries"("status", "next_attempt_at");

CREATE INDEX "notification_deliveries_organization_id_created_at_idx" ON "notification_deliveries"("organization_id", "created_at");

ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- No composite (organization_id, notification_id) FK here on purpose:
-- notification_id is NULL for a standalone send (the website-enquirer
-- acknowledgement has no Notification row), so MATCH SIMPLE already skips
-- the check exactly when there's nothing to check -- same as every other
-- nullable FK column elsewhere in this schema.

-- ---------------------------------------------------------------------------
-- 4. notification_preferences
-- ---------------------------------------------------------------------------

CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_preferences_organization_id_membership_id_type_key" ON "notification_preferences"("organization_id", "membership_id", "type");

ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_org_membership_fk"
  FOREIGN KEY ("organization_id", "membership_id")
  REFERENCES "memberships" ("organization_id", "id");

-- ---------------------------------------------------------------------------
-- 5. Row-level security
-- ---------------------------------------------------------------------------
--
-- All three tables are ordinary organization-scoped tables the application
-- both reads and writes through the RLS-scoped `figbloom_app` role (unlike
-- audit_events/website_lead_request_log, nothing here is append-only or
-- read-only) -- no custom grant/revoke needed beyond what
-- `scripts/db-admin.ts#grantRole`'s blanket ALL TABLES grant already covers
-- the next time it runs.

ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notifications"
  USING (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notification_deliveries"
  USING (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notification_preferences"
  USING (organization_id = current_setting('app.current_organization_id', true));
