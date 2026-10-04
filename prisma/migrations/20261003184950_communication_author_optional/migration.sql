-- FIG-598: Communication.authorMembershipId becomes optional -- an inbound
-- email logged by the webhook (src/services/inboundEmailService.ts) has no
-- CRM user to attribute it to. Every other create path (manual log,
-- "send and log email") still always stamps the caller's own membership.
--
-- Prisma's auto-generated diff for this migration also proposed DROPPING
-- every composite tenant-integrity foreign key (see the header comment on
-- `tenant_integrity_and_rls` for why those are hand-written and invisible
-- to schema.prisma). That diff was discarded; this file only adds what
-- FIG-598 actually needs, re-adding the one composite FK this change
-- actually touches (communications_org_author_membership_fk) since MATCH
-- SIMPLE already skips it correctly whenever the column is null.

ALTER TABLE "communications" ALTER COLUMN "author_membership_id" DROP NOT NULL;

-- Flagged by review while building this feature: every other parent
-- (company/lead/deal) already had a dedicated (organization_id, X_id,
-- occurred_at) index for its timeline query; contact was missing one.
CREATE INDEX "communications_organization_id_contact_id_occurred_at_idx" ON "communications"("organization_id", "contact_id", "occurred_at");

ALTER TABLE "communications" DROP CONSTRAINT "communications_author_membership_id_fkey";
ALTER TABLE "communications" ADD CONSTRAINT "communications_author_membership_id_fkey" FOREIGN KEY ("author_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "communications" DROP CONSTRAINT "communications_org_author_membership_fk";
ALTER TABLE "communications"
  ADD CONSTRAINT "communications_org_author_membership_fk"
  FOREIGN KEY ("organization_id", "author_membership_id")
  REFERENCES "memberships" ("organization_id", "id");
