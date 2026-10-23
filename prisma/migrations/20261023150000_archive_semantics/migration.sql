-- FIG-1045 (B2.16): one archive shape on every record that can be archived.
-- Companies, contacts, leads and deals already have `archived_at`; they gain
-- who archived them and why. Tasks gain all three. Writes to an archived
-- record are refused centrally (src/lib/archive.ts); restore clears all three.
--
-- Hand-written like the other tenant migrations: the "who" column gets the
-- same composite tenant foreign key as every other membership reference.

ALTER TABLE "companies" ADD COLUMN "archived_by_membership_id" TEXT, ADD COLUMN "archive_reason" TEXT;
ALTER TABLE "contacts"  ADD COLUMN "archived_by_membership_id" TEXT, ADD COLUMN "archive_reason" TEXT;
ALTER TABLE "leads"     ADD COLUMN "archived_by_membership_id" TEXT, ADD COLUMN "archive_reason" TEXT;
ALTER TABLE "deals"     ADD COLUMN "archived_by_membership_id" TEXT, ADD COLUMN "archive_reason" TEXT;
ALTER TABLE "tasks"     ADD COLUMN "archived_at" TIMESTAMP(3), ADD COLUMN "archived_by_membership_id" TEXT, ADD COLUMN "archive_reason" TEXT;

CREATE INDEX "tasks_organization_id_archived_at_idx" ON "tasks"("organization_id", "archived_at");

ALTER TABLE "companies" ADD CONSTRAINT "companies_org_archived_by_fk"
  FOREIGN KEY ("organization_id", "archived_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("archived_by_membership_id");
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_org_archived_by_fk"
  FOREIGN KEY ("organization_id", "archived_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("archived_by_membership_id");
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_archived_by_fk"
  FOREIGN KEY ("organization_id", "archived_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("archived_by_membership_id");
ALTER TABLE "deals" ADD CONSTRAINT "deals_org_archived_by_fk"
  FOREIGN KEY ("organization_id", "archived_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("archived_by_membership_id");
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_archived_by_fk"
  FOREIGN KEY ("organization_id", "archived_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("archived_by_membership_id");
