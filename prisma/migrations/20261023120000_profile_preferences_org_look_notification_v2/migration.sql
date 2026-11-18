-- FIG-1022 (B1.06) profile and avatar, FIG-1024 (B1.08) user preferences,
-- FIG-1025 (B1.09) organisation look, FIG-1027 (B1.11) notification
-- preferences v2.
--
-- Hand-written, same pattern as `files` and `deal_handoffs`: Prisma's
-- auto-diff would also propose dropping the hand-written composite tenant
-- foreign keys, so this file only adds what these issues need.

-- ---------------------------------------------------------------------------
-- B1.06: profile. Name and phone already live on `users`; add the time zone.
-- The picture belongs to the membership (a file is organisation-scoped).
-- ---------------------------------------------------------------------------
ALTER TABLE "users" ADD COLUMN "time_zone" TEXT;

ALTER TABLE "memberships"
  ADD COLUMN "avatar_file_id" TEXT,
  ADD COLUMN "avatar_crop" JSONB,
  ADD COLUMN "avatar_updated_at" TIMESTAMP(3);

-- The picture can only be a file of the membership's own organisation.
ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_org_avatar_file_fk"
  FOREIGN KEY ("organization_id", "avatar_file_id")
  REFERENCES "files" ("organization_id", "id")
  ON DELETE SET NULL ("avatar_file_id");

-- ---------------------------------------------------------------------------
-- B1.08: user preferences (account-stored; device-only settings are not here).
-- ---------------------------------------------------------------------------
CREATE TABLE "user_preferences" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'FOREST',
    "page_colour" TEXT NOT NULL DEFAULT 'WHITE',
    "toggle_light_page" TEXT NOT NULL DEFAULT 'WHITE',
    "toggle_dark_page" TEXT NOT NULL DEFAULT 'DARK',
    "density" TEXT NOT NULL DEFAULT 'COMFORTABLE',
    "start_page" TEXT,
    "sidebar" JSONB NOT NULL DEFAULT '{"collapsed":false,"hidden":[]}',
    "hour_format" TEXT NOT NULL DEFAULT 'H12',
    "first_day_of_week" TEXT NOT NULL DEFAULT 'MON',
    "date_format" TEXT NOT NULL DEFAULT 'DMY',
    "own_colours" JSONB,
    -- One step of undo for the last change: what it replaced, a hash of the
    -- token that restores it, and when the offer lapses.
    "undo_snapshot" JSONB,
    "undo_token_hash" TEXT,
    "undo_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_preferences_organization_id_membership_id_key"
  ON "user_preferences"("organization_id", "membership_id");

ALTER TABLE "user_preferences"
  ADD CONSTRAINT "user_preferences_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_preferences"
  ADD CONSTRAINT "user_preferences_org_membership_fk"
  FOREIGN KEY ("organization_id", "membership_id")
  REFERENCES "memberships" ("organization_id", "id")
  ON DELETE CASCADE;

ALTER TABLE "user_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_preferences" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "user_preferences"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

-- ---------------------------------------------------------------------------
-- B1.09: organisation look. `allowPersonalisation` is the existing
-- `personalisation.allowed` toggle, so it is not repeated here.
-- ---------------------------------------------------------------------------
ALTER TABLE "organizations"
  ADD COLUMN "display_name" TEXT,
  ADD COLUMN "logo_file_id" TEXT,
  ADD COLUMN "default_theme" TEXT NOT NULL DEFAULT 'FOREST',
  ADD COLUMN "default_page_colour" TEXT NOT NULL DEFAULT 'WHITE',
  ADD COLUMN "show_logo_on_client_pages" BOOLEAN NOT NULL DEFAULT false;

-- The logo can only be one of the organisation's own files.
ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_logo_file_fk"
  FOREIGN KEY ("id", "logo_file_id")
  REFERENCES "files" ("organization_id", "id")
  ON DELETE SET NULL ("logo_file_id");

-- ---------------------------------------------------------------------------
-- B1.11: notification preferences v2.
-- ---------------------------------------------------------------------------
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MENTION';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RENEWAL_DUE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROPOSAL_UNANSWERED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'STALLED_DEAL';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SUPPORT_ACCESS_REQUEST';

-- Push is a channel in the model from now on; nothing sends it until the PWA.
ALTER TABLE "notification_preferences" ADD COLUMN "push_enabled" BOOLEAN NOT NULL DEFAULT false;

-- A held-back email that goes out in the next digest instead of on its own.
ALTER TABLE "notification_deliveries" ADD COLUMN "digest_pending" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "notification_deliveries_digest_pending_next_attempt_at_idx"
  ON "notification_deliveries"("digest_pending", "next_attempt_at");

-- Quiet hours and the daily email cap, per member.
CREATE TABLE "notification_settings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "quiet_hours_enabled" BOOLEAN NOT NULL DEFAULT false,
    "quiet_hours_start" TEXT NOT NULL DEFAULT '20:00',
    "quiet_hours_end" TEXT NOT NULL DEFAULT '07:00',
    "daily_email_cap" INTEGER NOT NULL DEFAULT 20,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_settings_cap_check" CHECK ("daily_email_cap" BETWEEN 1 AND 200)
);

CREATE UNIQUE INDEX "notification_settings_organization_id_membership_id_key"
  ON "notification_settings"("organization_id", "membership_id");

ALTER TABLE "notification_settings"
  ADD CONSTRAINT "notification_settings_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_settings"
  ADD CONSTRAINT "notification_settings_org_membership_fk"
  FOREIGN KEY ("organization_id", "membership_id")
  REFERENCES "memberships" ("organization_id", "id")
  ON DELETE CASCADE;

ALTER TABLE "notification_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notification_settings"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
