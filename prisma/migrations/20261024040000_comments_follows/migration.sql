-- FIG-1044 (B2.15): comments, @mentions and following on records.
--
-- A comment belongs to exactly one record (company, contact, lead, deal or
-- task), each with a real composite foreign key so it cannot point at another
-- organisation's record and goes with the record. Editing and deleting are soft:
-- the row stays, marked edited or deleted, and the body of a deleted comment is
-- cleared. `comment_mentions` records who was mentioned, so an edit notifies
-- only people newly mentioned. `record_follows` says who wants to hear about a
-- record's new comments.

CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT,
    "contact_id" TEXT,
    "lead_id" TEXT,
    "deal_id" TEXT,
    "task_id" TEXT,
    "author_membership_id" TEXT,
    "body" TEXT NOT NULL,
    "edited_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "deleted_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "comments_one_record_check"
      CHECK ((("company_id" IS NOT NULL)::int + ("contact_id" IS NOT NULL)::int + ("lead_id" IS NOT NULL)::int + ("deal_id" IS NOT NULL)::int + ("task_id" IS NOT NULL)::int) = 1),
    CONSTRAINT "comments_body_check" CHECK ("deleted_at" IS NOT NULL OR char_length(btrim("body")) BETWEEN 1 AND 5000)
);

CREATE UNIQUE INDEX "comments_organization_id_id_key" ON "comments"("organization_id", "id");
CREATE INDEX "comments_company_idx" ON "comments"("company_id", "created_at") WHERE "company_id" IS NOT NULL;
CREATE INDEX "comments_contact_idx" ON "comments"("contact_id", "created_at") WHERE "contact_id" IS NOT NULL;
CREATE INDEX "comments_lead_idx" ON "comments"("lead_id", "created_at") WHERE "lead_id" IS NOT NULL;
CREATE INDEX "comments_deal_idx" ON "comments"("deal_id", "created_at") WHERE "deal_id" IS NOT NULL;
CREATE INDEX "comments_task_idx" ON "comments"("task_id", "created_at") WHERE "task_id" IS NOT NULL;

ALTER TABLE "comments"
  ADD CONSTRAINT "comments_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_org_company_fk"
  FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_org_contact_fk"
  FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_org_lead_fk"
  FOREIGN KEY ("organization_id", "lead_id") REFERENCES "leads" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_org_deal_fk"
  FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_org_task_fk"
  FOREIGN KEY ("organization_id", "task_id") REFERENCES "tasks" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_org_author_fk"
  FOREIGN KEY ("organization_id", "author_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("author_membership_id");
ALTER TABLE "comments" ADD CONSTRAINT "comments_org_deleted_by_fk"
  FOREIGN KEY ("organization_id", "deleted_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("deleted_by_membership_id");

CREATE TABLE "comment_mentions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_mentions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "comment_mentions_comment_member_key" ON "comment_mentions"("comment_id", "membership_id");
CREATE INDEX "comment_mentions_org_member_idx" ON "comment_mentions"("organization_id", "membership_id");

ALTER TABLE "comment_mentions"
  ADD CONSTRAINT "comment_mentions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_org_comment_fk"
  FOREIGN KEY ("organization_id", "comment_id") REFERENCES "comments" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "comment_mentions" ADD CONSTRAINT "comment_mentions_org_membership_fk"
  FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;

CREATE TABLE "record_follows" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "company_id" TEXT,
    "contact_id" TEXT,
    "lead_id" TEXT,
    "deal_id" TEXT,
    "task_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_follows_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "record_follows_one_record_check"
      CHECK ((("company_id" IS NOT NULL)::int + ("contact_id" IS NOT NULL)::int + ("lead_id" IS NOT NULL)::int + ("deal_id" IS NOT NULL)::int + ("task_id" IS NOT NULL)::int) = 1)
);

CREATE UNIQUE INDEX "record_follows_company_key" ON "record_follows"("membership_id", "company_id") WHERE "company_id" IS NOT NULL;
CREATE UNIQUE INDEX "record_follows_contact_key" ON "record_follows"("membership_id", "contact_id") WHERE "contact_id" IS NOT NULL;
CREATE UNIQUE INDEX "record_follows_lead_key" ON "record_follows"("membership_id", "lead_id") WHERE "lead_id" IS NOT NULL;
CREATE UNIQUE INDEX "record_follows_deal_key" ON "record_follows"("membership_id", "deal_id") WHERE "deal_id" IS NOT NULL;
CREATE UNIQUE INDEX "record_follows_task_key" ON "record_follows"("membership_id", "task_id") WHERE "task_id" IS NOT NULL;
CREATE INDEX "record_follows_org_member_idx" ON "record_follows"("organization_id", "membership_id");

ALTER TABLE "record_follows"
  ADD CONSTRAINT "record_follows_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "record_follows" ADD CONSTRAINT "record_follows_org_membership_fk"
  FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "record_follows" ADD CONSTRAINT "record_follows_org_company_fk"
  FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "record_follows" ADD CONSTRAINT "record_follows_org_contact_fk"
  FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "record_follows" ADD CONSTRAINT "record_follows_org_lead_fk"
  FOREIGN KEY ("organization_id", "lead_id") REFERENCES "leads" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "record_follows" ADD CONSTRAINT "record_follows_org_deal_fk"
  FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "record_follows" ADD CONSTRAINT "record_follows_org_task_fk"
  FOREIGN KEY ("organization_id", "task_id") REFERENCES "tasks" ("organization_id", "id") ON DELETE CASCADE;

ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "comments"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
ALTER TABLE "comment_mentions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comment_mentions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "comment_mentions"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
ALTER TABLE "record_follows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "record_follows" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "record_follows"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
