-- FIG-1053 (B3.07) conversations hub and FIG-1054 (B3.08) quick-log.

-- A message that matched no record is kept, unlinked, in the Needs-linking queue until a person
-- links it, turns it into a lead, or dismisses it with a reason.
ALTER TABLE "communications"
  ADD COLUMN "needs_linking" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "counterparty_email" TEXT,
  ADD COLUMN "counterparty_name" TEXT,
  ADD COLUMN "counterparty_phone" TEXT,
  ADD COLUMN "duration_seconds" INTEGER,
  ADD COLUMN "linked_at" TIMESTAMP(3),
  ADD COLUMN "linked_by_membership_id" TEXT,
  ADD COLUMN "dismissed_at" TIMESTAMP(3),
  ADD COLUMN "dismissed_by_membership_id" TEXT,
  ADD COLUMN "dismiss_reason" TEXT;

-- Every communication belongs to a record, unless it is waiting in the queue or was dismissed from it.
ALTER TABLE "communications" DROP CONSTRAINT "communications_has_subject_chk";
ALTER TABLE "communications"
  ADD CONSTRAINT "communications_has_subject_chk"
  CHECK (
    "company_id" IS NOT NULL OR "contact_id" IS NOT NULL OR
    "lead_id" IS NOT NULL OR "deal_id" IS NOT NULL OR
    "needs_linking" OR "dismissed_at" IS NOT NULL
  );
ALTER TABLE "communications"
  ADD CONSTRAINT "communications_dismiss_chk"
  CHECK (("dismissed_at" IS NULL) = ("dismiss_reason" IS NULL)),
  ADD CONSTRAINT "communications_duration_chk"
  CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0);

CREATE INDEX "communications_org_needs_linking_idx" ON "communications"("organization_id", "occurred_at" DESC) WHERE "needs_linking";
CREATE INDEX "communications_org_occurred_idx" ON "communications"("organization_id", "occurred_at" DESC);

ALTER TABLE "communications" ADD CONSTRAINT "communications_org_linked_by_fk" FOREIGN KEY ("organization_id", "linked_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("linked_by_membership_id");
ALTER TABLE "communications" ADD CONSTRAINT "communications_org_dismissed_by_fk" FOREIGN KEY ("organization_id", "dismissed_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("dismissed_by_membership_id");

-- Quick-log updates "last contacted" on the lead and the contact it was about.
ALTER TABLE "leads" ADD COLUMN "last_contacted_at" TIMESTAMP(3);
ALTER TABLE "contacts" ADD COLUMN "last_contacted_at" TIMESTAMP(3);
