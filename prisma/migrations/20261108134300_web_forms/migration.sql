-- FIG-1151 (B6.19): web forms that create leads through the public form endpoint, and the log of every attempt.
-- Hand-written, same reasoning as the other composite tenant foreign keys.

CREATE TABLE "web_forms" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "fields" JSONB NOT NULL DEFAULT '[]',
    "lead_source_key" TEXT,
    "success_message" TEXT NOT NULL DEFAULT 'Thank you. We will be in touch.',
    "allowed_origins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "honeypot_field_name" TEXT NOT NULL DEFAULT 'website_url',
    "captcha_secret" TEXT,
    "created_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_forms_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "web_forms_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    CONSTRAINT "web_forms_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX "web_forms_public_key_key" ON "web_forms"("public_key");
CREATE UNIQUE INDEX "web_forms_organization_id_id_key" ON "web_forms"("organization_id", "id");
CREATE UNIQUE INDEX "web_forms_org_lower_name_key" ON "web_forms"("organization_id", lower("name"));
CREATE INDEX "web_forms_organization_id_status_idx" ON "web_forms"("organization_id", "status");

ALTER TABLE "web_forms"
  ADD CONSTRAINT "web_forms_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "web_forms"
  ADD CONSTRAINT "web_forms_org_created_by_fk"
  FOREIGN KEY ("organization_id", "created_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("created_by_membership_id");

CREATE TABLE "web_form_submissions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "web_form_id" TEXT,
    "form_name" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "ip_address" TEXT,
    "origin" TEXT,
    "lead_id" TEXT,
    "duplicate_contact" BOOLEAN NOT NULL DEFAULT false,
    "duplicate_company" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_form_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "web_form_submissions_organization_id_created_at_idx" ON "web_form_submissions"("organization_id", "created_at");
CREATE INDEX "web_form_submissions_web_form_id_created_at_idx" ON "web_form_submissions"("web_form_id", "created_at");

ALTER TABLE "web_form_submissions"
  ADD CONSTRAINT "web_form_submissions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Deleting a form or a lead keeps the log row.
ALTER TABLE "web_form_submissions"
  ADD CONSTRAINT "web_form_submissions_org_form_fk"
  FOREIGN KEY ("organization_id", "web_form_id") REFERENCES "web_forms" ("organization_id", "id")
  ON DELETE SET NULL ("web_form_id");
ALTER TABLE "web_form_submissions"
  ADD CONSTRAINT "web_form_submissions_org_lead_fk"
  FOREIGN KEY ("organization_id", "lead_id") REFERENCES "leads" ("organization_id", "id")
  ON DELETE SET NULL ("lead_id");

ALTER TABLE "web_forms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "web_forms" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "web_forms"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "web_form_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "web_form_submissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "web_form_submissions"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
