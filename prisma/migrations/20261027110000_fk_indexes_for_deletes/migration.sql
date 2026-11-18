-- B4.04, B4.05: removing a company or a contact (a migration rollback, an erasure) makes the database check every table that points at
-- it. These foreign keys had no index, so each delete scanned a whole table. Partial indexes: only rows that point at something.
CREATE INDEX IF NOT EXISTS "tasks_company_fk_idx" ON "tasks"("company_id") WHERE "company_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "tasks_contact_fk_idx" ON "tasks"("contact_id") WHERE "contact_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "companies_merged_into_fk_idx" ON "companies"("merged_into_id") WHERE "merged_into_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "contacts_merged_into_fk_idx" ON "contacts"("merged_into_id") WHERE "merged_into_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "deals_primary_contact_fk_idx" ON "deals"("primary_contact_id") WHERE "primary_contact_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "leads_contact_fk_idx" ON "leads"("contact_id") WHERE "contact_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "activities_contact_fk_idx" ON "activities"("contact_id") WHERE "contact_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "comments_contact_fk_idx" ON "comments"("contact_id") WHERE "contact_id" IS NOT NULL;
