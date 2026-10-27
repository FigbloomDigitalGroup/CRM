-- G1.04 (FIG-1071): search at scale.
--
-- The list services match a search box against several columns with OR. One unindexed column in an OR forces a sequential scan of the
-- whole table, however well the others are indexed, so every column a search reads now has a trigram index (search_v2 covered names,
-- emails and task titles only). Measured on 50,000 leads / 20,000 contacts / 8,000 companies in docs/PERF_BASELINE.md.

CREATE INDEX "companies_phone_trgm_idx" ON "companies" USING gin ("phone" gin_trgm_ops);
CREATE INDEX "contacts_phone_trgm_idx" ON "contacts" USING gin ("phone" gin_trgm_ops);
CREATE INDEX "leads_notes_trgm_idx" ON "leads" USING gin ("notes" gin_trgm_ops);
CREATE INDEX "deals_notes_trgm_idx" ON "deals" USING gin ("notes" gin_trgm_ops);
CREATE INDEX "tasks_description_trgm_idx" ON "tasks" USING gin ("description" gin_trgm_ops);
