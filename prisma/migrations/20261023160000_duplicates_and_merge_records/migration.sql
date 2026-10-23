-- FIG-1033 (B2.04): duplicate detection and undoable merges.
--
-- 1. Expression indexes so a duplicate lookup is an index probe, not a scan.
--    They match the normal forms in src/lib/matching.ts: the last nine digits
--    of a phone number, and a lower-case email without plus-addressing.
-- 2. `merge_records`: what a merge moved, so it can be undone for a short
--    period. The loser is archived (never deleted) either way.

CREATE INDEX "contacts_phone_tail_idx" ON "contacts" ("organization_id", right(regexp_replace("phone", '\D', '', 'g'), 9)) WHERE "phone" IS NOT NULL;
CREATE INDEX "contacts_email_norm_idx" ON "contacts" ("organization_id", lower(regexp_replace("email", '\+[^@]*@', '@'))) WHERE "email" IS NOT NULL;
CREATE INDEX "companies_phone_tail_idx" ON "companies" ("organization_id", right(regexp_replace("phone", '\D', '', 'g'), 9)) WHERE "phone" IS NOT NULL;
CREATE INDEX "companies_email_norm_idx" ON "companies" ("organization_id", lower(regexp_replace("email", '\+[^@]*@', '@'))) WHERE "email" IS NOT NULL;
CREATE INDEX "companies_name_lower_idx" ON "companies" ("organization_id", lower("name"));

CREATE TABLE "merge_records" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "winner_id" TEXT NOT NULL,
    "loser_id" TEXT NOT NULL,
    "merged_by_membership_id" TEXT,
    "merged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undo_expires_at" TIMESTAMP(3) NOT NULL,
    "undone_at" TIMESTAMP(3),
    "undone_by_membership_id" TEXT,
    -- Which rows were re-pointed (ids per table) and the field values before the merge.
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "merge_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "merge_records_entity_type_check" CHECK ("entity_type" IN ('Company', 'Contact'))
);

CREATE INDEX "merge_records_org_entity_idx" ON "merge_records"("organization_id", "entity_type", "merged_at");
CREATE INDEX "merge_records_org_loser_idx" ON "merge_records"("organization_id", "loser_id");

ALTER TABLE "merge_records"
  ADD CONSTRAINT "merge_records_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "merge_records"
  ADD CONSTRAINT "merge_records_org_merged_by_fk"
  FOREIGN KEY ("organization_id", "merged_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("merged_by_membership_id");

ALTER TABLE "merge_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "merge_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "merge_records"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
