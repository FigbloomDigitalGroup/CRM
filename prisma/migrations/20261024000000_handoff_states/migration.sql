-- FIG-1037 (B2.08): handoff states and what Delivery works from.
--
-- A handoff is Awaiting owner (no Delivery owner yet), Onboarding, or Delivered.
-- Handoffs that already exist have an owner, so they are Onboarding.

CREATE TYPE "HandoffStatus" AS ENUM ('AWAITING_OWNER', 'ONBOARDING', 'DELIVERED');

ALTER TABLE "deal_handoffs"
  ADD COLUMN "status" "HandoffStatus" NOT NULL DEFAULT 'ONBOARDING',
  ADD COLUMN "start_date" DATE,
  ADD COLUMN "scope" TEXT,
  ADD COLUMN "requirements" TEXT,
  -- [{"title": "...", "done": false}]
  ADD COLUMN "deliverables" JSONB NOT NULL DEFAULT '[]',
  -- Membership ids working on it besides the owner.
  ADD COLUMN "team_membership_ids" JSONB NOT NULL DEFAULT '[]',
  -- The onboarding tasks are created once, when an owner exists.
  ADD COLUMN "tasks_created_at" TIMESTAMP(3),
  ADD COLUMN "owner_taken_at" TIMESTAMP(3),
  ADD COLUMN "delivered_at" TIMESTAMP(3),
  ADD COLUMN "delivered_by_membership_id" TEXT,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- "Owner later": no owner until someone in Delivery takes it.
ALTER TABLE "deal_handoffs" ALTER COLUMN "delivery_owner_membership_id" DROP NOT NULL;
UPDATE "deal_handoffs" SET "tasks_created_at" = "created_at", "owner_taken_at" = "created_at"
  WHERE "delivery_owner_membership_id" IS NOT NULL;

ALTER TABLE "deal_handoffs" ADD CONSTRAINT "deal_handoffs_owner_status_check"
  CHECK (("status" = 'AWAITING_OWNER') = ("delivery_owner_membership_id" IS NULL));

ALTER TABLE "deal_handoffs"
  ADD CONSTRAINT "deal_handoffs_org_delivered_by_fk"
  FOREIGN KEY ("organization_id", "delivered_by_membership_id")
  REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("delivered_by_membership_id");

CREATE INDEX "deal_handoffs_organization_id_status_idx" ON "deal_handoffs"("organization_id", "status");
