-- FIG-1041 (B2.12): global search v2.
--
-- Trigram indexes so the case-insensitive "contains" searches on names, emails
-- and titles stay fast as the data grows, and a small per-user list of recent
-- searches. Phone numbers are matched through the existing last-nine-digits
-- indexes (contacts_phone_tail_idx, companies_phone_tail_idx), so +254, 0712
-- and 712 forms all find the same record.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "companies_name_trgm_idx" ON "companies" USING gin ("name" gin_trgm_ops);
CREATE INDEX "companies_email_trgm_idx" ON "companies" USING gin ("email" gin_trgm_ops);
CREATE INDEX "contacts_first_name_trgm_idx" ON "contacts" USING gin ("first_name" gin_trgm_ops);
CREATE INDEX "contacts_last_name_trgm_idx" ON "contacts" USING gin ("last_name" gin_trgm_ops);
CREATE INDEX "contacts_email_trgm_idx" ON "contacts" USING gin ("email" gin_trgm_ops);
CREATE INDEX "tasks_title_trgm_idx" ON "tasks" USING gin ("title" gin_trgm_ops);

CREATE TABLE "search_recents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_recents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "search_recents_query_check" CHECK (char_length("query") BETWEEN 2 AND 100)
);

CREATE UNIQUE INDEX "search_recents_member_query_key" ON "search_recents"("organization_id", "membership_id", lower("query"));
CREATE INDEX "search_recents_member_used_idx" ON "search_recents"("organization_id", "membership_id", "last_used_at" DESC);

ALTER TABLE "search_recents"
  ADD CONSTRAINT "search_recents_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "search_recents"
  ADD CONSTRAINT "search_recents_org_membership_fk"
  FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE CASCADE;

ALTER TABLE "search_recents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "search_recents" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "search_recents"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
