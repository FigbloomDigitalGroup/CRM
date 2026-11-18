-- FIG-796: files attached to companies, contacts, leads, deals and tasks.
--
-- The bytes live in the storage driver and are described by a `files` row
-- (B1.07). An `attachments` row says which record the file belongs to and who
-- may see it. Exactly one record column is set, each with a real composite
-- foreign key, so an attachment goes with its record and can never point at
-- another organisation's record or file.

CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "company_id" TEXT,
    "contact_id" TEXT,
    "lead_id" TEXT,
    "deal_id" TEXT,
    "task_id" TEXT,
    -- A proposal on the deal this file belongs with (optional; deals only).
    "proposal_reference_id" TEXT,
    "title" TEXT,
    -- Files on a deal are visible only to people who may see deal values, unless shared.
    "shared" BOOLEAN NOT NULL DEFAULT true,
    "uploaded_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attachments_one_record_check"
      CHECK ((("company_id" IS NOT NULL)::int + ("contact_id" IS NOT NULL)::int + ("lead_id" IS NOT NULL)::int + ("deal_id" IS NOT NULL)::int + ("task_id" IS NOT NULL)::int) = 1),
    CONSTRAINT "attachments_proposal_deal_check" CHECK ("proposal_reference_id" IS NULL OR "deal_id" IS NOT NULL)
);

-- Target of the composite foreign key from attachments (the other record tables already have one).
CREATE UNIQUE INDEX "tasks_organization_id_id_key" ON "tasks"("organization_id", "id");

CREATE UNIQUE INDEX "attachments_file_id_key" ON "attachments"("file_id");
CREATE INDEX "attachments_company_idx" ON "attachments"("company_id") WHERE "company_id" IS NOT NULL;
CREATE INDEX "attachments_contact_idx" ON "attachments"("contact_id") WHERE "contact_id" IS NOT NULL;
CREATE INDEX "attachments_lead_idx" ON "attachments"("lead_id") WHERE "lead_id" IS NOT NULL;
CREATE INDEX "attachments_deal_idx" ON "attachments"("deal_id") WHERE "deal_id" IS NOT NULL;
CREATE INDEX "attachments_task_idx" ON "attachments"("task_id") WHERE "task_id" IS NOT NULL;
CREATE INDEX "attachments_org_created_idx" ON "attachments"("organization_id", "created_at");

ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_org_file_fk"
  FOREIGN KEY ("organization_id", "file_id") REFERENCES "files" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_org_company_fk"
  FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_org_contact_fk"
  FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_org_lead_fk"
  FOREIGN KEY ("organization_id", "lead_id") REFERENCES "leads" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_org_deal_fk"
  FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_org_task_fk"
  FOREIGN KEY ("organization_id", "task_id") REFERENCES "tasks" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_org_uploaded_by_fk"
  FOREIGN KEY ("organization_id", "uploaded_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("uploaded_by_membership_id");

ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "attachments"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
