-- FIG-1020 (B1.04), FIG-1021 (B1.05), FIG-1028 (B1.12): who is signed in
-- where, how long they have left, who signed in or failed to, account
-- lockout, and clear membership states (invited, active, deactivated,
-- removed) with timestamps and who acted.
--
-- Hand-written, same pattern as `files` and `deal_handoffs`: Prisma's
-- auto-diff would also propose dropping the hand-written composite tenant
-- foreign keys, so this file only adds what these three issues need.

-- ---------------------------------------------------------------------------
-- Sessions: device, place, lifetime ceiling and tenant scope.
-- ---------------------------------------------------------------------------
ALTER TABLE "sessions"
  ADD COLUMN "organization_id" TEXT,
  ADD COLUMN "device_label" TEXT,
  ADD COLUMN "ip_address" TEXT,
  ADD COLUMN "place" TEXT,
  ADD COLUMN "absolute_expires_at" TIMESTAMP(3),
  ADD COLUMN "revoked_reason" TEXT;

-- Existing sessions keep the lifetime they were issued with.
UPDATE "sessions" SET "absolute_expires_at" = "expires_at";
ALTER TABLE "sessions" ALTER COLUMN "absolute_expires_at" SET NOT NULL;

CREATE INDEX "sessions_organization_id_idx" ON "sessions"("organization_id");

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Sessions are written and resolved by the server on the admin connection
-- (a request has no organisation context before its cookie is resolved), so
-- RLS here is the backstop: nothing running as the application role can read
-- or touch a session outside the organisation context it was given.
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sessions"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

-- ---------------------------------------------------------------------------
-- Sign-in events: success, failure, lockout, new device.
-- ---------------------------------------------------------------------------
CREATE TYPE "SignInOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'LOCKOUT', 'NEW_DEVICE');

CREATE TABLE "sign_in_events" (
    "id" TEXT NOT NULL,
    -- NULL only for an attempt that cannot be tied to any organisation (an
    -- unknown email, or a user with no membership). Those rows are invisible
    -- to every tenant.
    "organization_id" TEXT,
    "user_id" TEXT,
    "email" TEXT NOT NULL,
    "outcome" "SignInOutcome" NOT NULL,
    "reason" TEXT,
    "session_id" TEXT,
    "device_label" TEXT,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "place" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sign_in_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sign_in_events_organization_id_created_at_idx" ON "sign_in_events"("organization_id", "created_at");
CREATE INDEX "sign_in_events_organization_id_user_id_idx" ON "sign_in_events"("organization_id", "user_id");
CREATE INDEX "sign_in_events_organization_id_outcome_idx" ON "sign_in_events"("organization_id", "outcome");
CREATE INDEX "sign_in_events_user_id_device_label_idx" ON "sign_in_events"("user_id", "device_label");

ALTER TABLE "sign_in_events"
  ADD CONSTRAINT "sign_in_events_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sign_in_events"
  ADD CONSTRAINT "sign_in_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sign_in_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sign_in_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sign_in_events"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

-- ---------------------------------------------------------------------------
-- Account lockout (an account, not an organisation, is what gets locked).
-- ---------------------------------------------------------------------------
ALTER TABLE "users"
  ADD COLUMN "failed_sign_in_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_failed_sign_in_at" TIMESTAMP(3),
  ADD COLUMN "locked_until" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- Membership states: invited / active / deactivated / removed, with
-- timestamps and who acted.
-- ---------------------------------------------------------------------------
ALTER TYPE "MembershipStatus" ADD VALUE IF NOT EXISTS 'REMOVED';

ALTER TABLE "memberships"
  ADD COLUMN "invited_by_membership_id" TEXT,
  ADD COLUMN "invite_last_sent_at" TIMESTAMP(3),
  ADD COLUMN "deactivated_at" TIMESTAMP(3),
  ADD COLUMN "deactivated_by_membership_id" TEXT,
  ADD COLUMN "removed_at" TIMESTAMP(3),
  ADD COLUMN "removed_by_membership_id" TEXT;

-- An actor can only be a membership of the same organisation.
ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_org_invited_by_fk"
  FOREIGN KEY ("organization_id", "invited_by_membership_id")
  REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("invited_by_membership_id");
ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_org_deactivated_by_fk"
  FOREIGN KEY ("organization_id", "deactivated_by_membership_id")
  REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("deactivated_by_membership_id");
ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_org_removed_by_fk"
  FOREIGN KEY ("organization_id", "removed_by_membership_id")
  REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("removed_by_membership_id");
