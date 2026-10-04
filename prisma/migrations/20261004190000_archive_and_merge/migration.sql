-- FIG-601: soft-delete/archive + restore for Lead/Contact/Company/Deal, and
-- a "merged into" pointer for Contact/Company (set when one record is the
-- "loser" of a merge, always archived at the same time -- see
-- src/services/companyService.ts's/contactService.ts's archive/merge
-- functions and IMPLEMENTATION_NOTES.md).
--
-- As with every migration in this project, Prisma's auto-diff for this
-- change also proposed dropping every composite tenant-integrity foreign
-- key (see tenant_integrity_and_rls's header comment); that diff was
-- discarded and this file only adds what FIG-601 actually needs, including
-- a NEW composite tenant-integrity FK for each of the two new
-- merged_into_id columns.

ALTER TABLE "companies" ADD COLUMN "archived_at" TIMESTAMP(3);
ALTER TABLE "companies" ADD COLUMN "merged_into_id" TEXT;
ALTER TABLE "contacts" ADD COLUMN "archived_at" TIMESTAMP(3);
ALTER TABLE "contacts" ADD COLUMN "merged_into_id" TEXT;
ALTER TABLE "leads" ADD COLUMN "archived_at" TIMESTAMP(3);
ALTER TABLE "deals" ADD COLUMN "archived_at" TIMESTAMP(3);

CREATE INDEX "companies_organization_id_archived_at_idx" ON "companies"("organization_id", "archived_at");
CREATE INDEX "contacts_organization_id_archived_at_idx" ON "contacts"("organization_id", "archived_at");
CREATE INDEX "leads_organization_id_archived_at_idx" ON "leads"("organization_id", "archived_at");
CREATE INDEX "deals_organization_id_archived_at_idx" ON "deals"("organization_id", "archived_at");

ALTER TABLE "companies" ADD CONSTRAINT "companies_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "companies"
  ADD CONSTRAINT "companies_org_merged_into_fk"
  FOREIGN KEY ("organization_id", "merged_into_id")
  REFERENCES "companies" ("organization_id", "id");

ALTER TABLE "contacts" ADD CONSTRAINT "contacts_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_org_merged_into_fk"
  FOREIGN KEY ("organization_id", "merged_into_id")
  REFERENCES "contacts" ("organization_id", "id");
