-- FIG-1155 (B6.23): Customer Support: tickets linked to customers, and satisfaction surveys.
--
-- Decision-gated (docs/DECISIONS.md 2.4): the role stays behind `customer_support.role`, and the
-- permission `tickets.manage` carries a V1.1 release minimum (prisma/seedData.ts). These tables hold no
-- deal value, cost or payment, and a ticket never copies one from a customer.

ALTER TYPE "AuthRateLimitAction" ADD VALUE IF NOT EXISTS 'SURVEY_RESPONSE';

CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "company_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "owner_membership_id" TEXT,
    "opened_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tickets_title_check" CHECK (char_length(btrim("title")) BETWEEN 1 AND 160),
    CONSTRAINT "tickets_status_check" CHECK ("status" IN ('OPEN', 'WAITING_ON_CLIENT', 'RESOLVED')),
    CONSTRAINT "tickets_priority_check" CHECK ("priority" IN ('HIGH', 'MEDIUM', 'LOW'))
);
CREATE UNIQUE INDEX "tickets_organization_id_number_key" ON "tickets"("organization_id", "number");
CREATE UNIQUE INDEX "tickets_organization_id_id_key" ON "tickets"("organization_id", "id");
CREATE INDEX "tickets_organization_id_status_idx" ON "tickets"("organization_id", "status");
CREATE INDEX "tickets_organization_id_company_id_idx" ON "tickets"("organization_id", "company_id");

CREATE TABLE "ticket_messages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "author_membership_id" TEXT,
    "author_label" TEXT,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ticket_messages_kind_check" CHECK ("kind" IN ('CUSTOMER', 'STAFF', 'INTERNAL')),
    CONSTRAINT "ticket_messages_body_check" CHECK (char_length(btrim("body")) BETWEEN 1 AND 5000)
);
CREATE INDEX "ticket_messages_organization_id_ticket_id_idx" ON "ticket_messages"("organization_id", "ticket_id", "created_at");

-- The customer answers through a link carrying a random token (only its SHA-256 is stored). One answer per survey.
CREATE TABLE "satisfaction_surveys" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "ticket_id" TEXT,
    "token_hash" TEXT NOT NULL,
    "sent_to_email" TEXT NOT NULL,
    "sent_by_membership_id" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "responded_at" TIMESTAMP(3),
    "score" INTEGER,
    "comment" TEXT,
    CONSTRAINT "satisfaction_surveys_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "satisfaction_surveys_score_check" CHECK ("score" IS NULL OR "score" BETWEEN 1 AND 5),
    CONSTRAINT "satisfaction_surveys_answer_check" CHECK (("responded_at" IS NULL) = ("score" IS NULL))
);
CREATE UNIQUE INDEX "satisfaction_surveys_token_hash_key" ON "satisfaction_surveys"("token_hash");
CREATE INDEX "satisfaction_surveys_organization_id_company_id_idx" ON "satisfaction_surveys"("organization_id", "company_id");
CREATE INDEX "satisfaction_surveys_organization_id_sent_at_idx" ON "satisfaction_surveys"("organization_id", "sent_at");

-- Same-organisation foreign keys (composite), like every other tenant table.
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_org_company_fk" FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies" ("organization_id", "id");
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_org_contact_fk" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts" ("organization_id", "id") ON DELETE SET NULL ("contact_id");
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_org_owner_fk" FOREIGN KEY ("organization_id", "owner_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("owner_membership_id");
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_org_opened_by_fk" FOREIGN KEY ("organization_id", "opened_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("opened_by_membership_id");

ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_org_ticket_fk" FOREIGN KEY ("organization_id", "ticket_id") REFERENCES "tickets" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_org_author_fk" FOREIGN KEY ("organization_id", "author_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("author_membership_id");

ALTER TABLE "satisfaction_surveys" ADD CONSTRAINT "satisfaction_surveys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "satisfaction_surveys" ADD CONSTRAINT "satisfaction_surveys_org_company_fk" FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies" ("organization_id", "id");
ALTER TABLE "satisfaction_surveys" ADD CONSTRAINT "satisfaction_surveys_org_contact_fk" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts" ("organization_id", "id") ON DELETE SET NULL ("contact_id");
ALTER TABLE "satisfaction_surveys" ADD CONSTRAINT "satisfaction_surveys_org_ticket_fk" FOREIGN KEY ("organization_id", "ticket_id") REFERENCES "tickets" ("organization_id", "id") ON DELETE SET NULL ("ticket_id");
ALTER TABLE "satisfaction_surveys" ADD CONSTRAINT "satisfaction_surveys_org_sent_by_fk" FOREIGN KEY ("organization_id", "sent_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("sent_by_membership_id");

-- Row-level security, forced, on the caller's organisation.
ALTER TABLE "tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tickets" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tickets"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
ALTER TABLE "ticket_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ticket_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ticket_messages"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
ALTER TABLE "satisfaction_surveys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "satisfaction_surveys" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "satisfaction_surveys"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
