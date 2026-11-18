-- FIG-1600 (P2-17): Management hears about team activity. One new notification type, who did it on a
-- notification, each person's choice per event (channels and instant/hourly/daily), and the queue
-- of digest items. Both new tables are tenant tables with row-level security.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TEAM_ACTIVITY';

ALTER TABLE "notifications" ADD COLUMN "actor_membership_id" TEXT;
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_actor_membership_id_fkey"
  FOREIGN KEY ("actor_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "team_activity_preferences" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "membership_id" TEXT NOT NULL,
  "event_key" TEXT NOT NULL,
  "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
  "email_enabled" BOOLEAN NOT NULL DEFAULT false,
  "push_enabled" BOOLEAN NOT NULL DEFAULT false,
  "mode" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "team_activity_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "team_activity_preferences_mode_check" CHECK ("mode" IS NULL OR "mode" IN ('INSTANT', 'HOURLY', 'DAILY'))
);
CREATE UNIQUE INDEX "team_activity_preferences_org_member_event_key"
  ON "team_activity_preferences"("organization_id", "membership_id", "event_key");
ALTER TABLE "team_activity_preferences"
  ADD CONSTRAINT "team_activity_preferences_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_activity_preferences"
  ADD CONSTRAINT "team_activity_preferences_membership_id_fkey"
  FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "team_activity_pending" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "recipient_membership_id" TEXT NOT NULL,
  "event_key" TEXT NOT NULL,
  "actor_membership_id" TEXT,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "detail" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatched_at" TIMESTAMP(3),
  CONSTRAINT "team_activity_pending_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "team_activity_pending_due_idx"
  ON "team_activity_pending"("organization_id", "recipient_membership_id", "dispatched_at", "created_at");
ALTER TABLE "team_activity_pending"
  ADD CONSTRAINT "team_activity_pending_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_activity_pending"
  ADD CONSTRAINT "team_activity_pending_recipient_fkey"
  FOREIGN KEY ("recipient_membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "team_activity_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_activity_preferences" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "team_activity_preferences"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "team_activity_pending" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "team_activity_pending" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "team_activity_pending"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
