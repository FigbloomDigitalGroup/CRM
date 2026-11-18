-- FIG-797: reusable email templates for "Send and log email".
--
-- A template is a name, a subject and a body with merge fields such as
-- {{contact.firstName}}. The template used is recorded on the Communication.

CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_templates_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX "email_templates_org_lower_name_key" ON "email_templates"("organization_id", lower("name"));
CREATE UNIQUE INDEX "email_templates_organization_id_id_key" ON "email_templates"("organization_id", "id");

ALTER TABLE "email_templates"
  ADD CONSTRAINT "email_templates_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_templates"
  ADD CONSTRAINT "email_templates_org_created_by_fk"
  FOREIGN KEY ("organization_id", "created_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("created_by_membership_id");

ALTER TABLE "email_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "email_templates"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "communications" ADD COLUMN "email_template_id" TEXT;
-- Deleting a template keeps the communications that used it.
ALTER TABLE "communications"
  ADD CONSTRAINT "communications_org_email_template_fk"
  FOREIGN KEY ("organization_id", "email_template_id") REFERENCES "email_templates" ("organization_id", "id")
  ON DELETE SET NULL ("email_template_id");
