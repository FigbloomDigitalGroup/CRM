-- FIG-798: tags on companies, contacts, leads and deals.
--
-- `tags` holds the organisation's tags; `tag_links` ties a tag to exactly one
-- record. One link table with four nullable record columns (one set per row)
-- rather than a polymorphic "type + id" pair, so each link has a real foreign
-- key to its record and is removed with it.

CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- A colour from the design palette (a key such as "forest"), or a hex value.
    "colour" TEXT NOT NULL DEFAULT 'forest',
    "created_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tags_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 40)
);

-- A tag name is unique per organisation without regard to case.
CREATE UNIQUE INDEX "tags_org_lower_name_key" ON "tags"("organization_id", lower("name"));
CREATE UNIQUE INDEX "tags_organization_id_id_key" ON "tags"("organization_id", "id");

ALTER TABLE "tags"
  ADD CONSTRAINT "tags_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tags"
  ADD CONSTRAINT "tags_org_created_by_fk"
  FOREIGN KEY ("organization_id", "created_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("created_by_membership_id");

CREATE TABLE "tag_links" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "company_id" TEXT,
    "contact_id" TEXT,
    "lead_id" TEXT,
    "deal_id" TEXT,
    "created_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tag_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tag_links_one_record_check"
      CHECK ((("company_id" IS NOT NULL)::int + ("contact_id" IS NOT NULL)::int + ("lead_id" IS NOT NULL)::int + ("deal_id" IS NOT NULL)::int) = 1)
);

-- One link per tag and record.
CREATE UNIQUE INDEX "tag_links_tag_company_key" ON "tag_links"("tag_id", "company_id") WHERE "company_id" IS NOT NULL;
CREATE UNIQUE INDEX "tag_links_tag_contact_key" ON "tag_links"("tag_id", "contact_id") WHERE "contact_id" IS NOT NULL;
CREATE UNIQUE INDEX "tag_links_tag_lead_key" ON "tag_links"("tag_id", "lead_id") WHERE "lead_id" IS NOT NULL;
CREATE UNIQUE INDEX "tag_links_tag_deal_key" ON "tag_links"("tag_id", "deal_id") WHERE "deal_id" IS NOT NULL;
CREATE INDEX "tag_links_company_idx" ON "tag_links"("company_id") WHERE "company_id" IS NOT NULL;
CREATE INDEX "tag_links_contact_idx" ON "tag_links"("contact_id") WHERE "contact_id" IS NOT NULL;
CREATE INDEX "tag_links_lead_idx" ON "tag_links"("lead_id") WHERE "lead_id" IS NOT NULL;
CREATE INDEX "tag_links_deal_idx" ON "tag_links"("deal_id") WHERE "deal_id" IS NOT NULL;
CREATE INDEX "tag_links_org_tag_idx" ON "tag_links"("organization_id", "tag_id");

ALTER TABLE "tag_links"
  ADD CONSTRAINT "tag_links_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
-- The tag and the record must both belong to the link's organisation.
ALTER TABLE "tag_links" ADD CONSTRAINT "tag_links_org_tag_fk"
  FOREIGN KEY ("organization_id", "tag_id") REFERENCES "tags" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "tag_links" ADD CONSTRAINT "tag_links_org_company_fk"
  FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "tag_links" ADD CONSTRAINT "tag_links_org_contact_fk"
  FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "tag_links" ADD CONSTRAINT "tag_links_org_lead_fk"
  FOREIGN KEY ("organization_id", "lead_id") REFERENCES "leads" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "tag_links" ADD CONSTRAINT "tag_links_org_deal_fk"
  FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "tag_links" ADD CONSTRAINT "tag_links_org_created_by_fk"
  FOREIGN KEY ("organization_id", "created_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("created_by_membership_id");

ALTER TABLE "tags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tags" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tags"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
ALTER TABLE "tag_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tag_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tag_links"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
