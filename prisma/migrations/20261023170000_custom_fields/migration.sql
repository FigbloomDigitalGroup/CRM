-- FIG-803 and FIG-1030 (B2.01): organisation-defined custom fields, and the
-- per-service qualification questions that are the same thing with a section
-- and a service attached.
--
-- Definitions live in `custom_field_definitions`. Values live on the record:
-- general custom fields in `custom_fields` (new on contacts, companies, deals
-- and leads); a lead's qualification answers stay in the existing
-- `qualification_data` column, so nothing has to be copied.

CREATE TYPE "CustomFieldEntity" AS ENUM ('LEAD', 'CONTACT', 'COMPANY', 'DEAL');
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'SELECT', 'MULTISELECT', 'BOOLEAN');
CREATE TYPE "CustomFieldSection" AS ENUM ('GENERAL', 'QUALIFICATION');

CREATE TABLE "custom_field_definitions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "entity_type" "CustomFieldEntity" NOT NULL,
    "section" "CustomFieldSection" NOT NULL DEFAULT 'GENERAL',
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "field_type" "CustomFieldType" NOT NULL DEFAULT 'TEXT',
    -- SELECT and MULTISELECT: [{"value": "...", "label": "..."}]
    "options" JSONB,
    "help_text" TEXT,
    -- Required whenever the record is saved.
    "required" BOOLEAN NOT NULL DEFAULT false,
    -- Qualification only: required before a lead can move to Qualified.
    "required_on_qualify" BOOLEAN NOT NULL DEFAULT false,
    -- Qualification only: the service this question belongs to; null means every service.
    "service_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "custom_field_definitions_key_check" CHECK ("key" ~ '^[a-z][a-z0-9_]{0,49}$'),
    CONSTRAINT "custom_field_definitions_qualification_lead_check"
      CHECK ("section" = 'GENERAL' OR "entity_type" = 'LEAD'),
    CONSTRAINT "custom_field_definitions_service_qualification_check"
      CHECK ("service_id" IS NULL OR "section" = 'QUALIFICATION')
);

CREATE UNIQUE INDEX "custom_field_definitions_org_entity_key_key" ON "custom_field_definitions"("organization_id", "entity_type", "key");
CREATE UNIQUE INDEX "custom_field_definitions_organization_id_id_key" ON "custom_field_definitions"("organization_id", "id");
CREATE INDEX "custom_field_definitions_org_entity_active_idx" ON "custom_field_definitions"("organization_id", "entity_type", "is_active", "sort_order");

ALTER TABLE "custom_field_definitions"
  ADD CONSTRAINT "custom_field_definitions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- A service can only be one of the organisation's own.
ALTER TABLE "custom_field_definitions"
  ADD CONSTRAINT "custom_field_definitions_org_service_fk"
  FOREIGN KEY ("organization_id", "service_id") REFERENCES "services" ("organization_id", "id")
  ON DELETE CASCADE;

ALTER TABLE "custom_field_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_field_definitions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "custom_field_definitions"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

-- Values on the records, with a GIN index so a list can filter on them.
ALTER TABLE "leads"     ADD COLUMN "custom_fields" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "contacts"  ADD COLUMN "custom_fields" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "companies" ADD COLUMN "custom_fields" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "deals"     ADD COLUMN "custom_fields" JSONB NOT NULL DEFAULT '{}';
CREATE INDEX "leads_custom_fields_gin" ON "leads" USING GIN ("custom_fields" jsonb_path_ops);
CREATE INDEX "contacts_custom_fields_gin" ON "contacts" USING GIN ("custom_fields" jsonb_path_ops);
CREATE INDEX "companies_custom_fields_gin" ON "companies" USING GIN ("custom_fields" jsonb_path_ops);
CREATE INDEX "deals_custom_fields_gin" ON "deals" USING GIN ("custom_fields" jsonb_path_ops);

-- Existing qualification keys become definitions (FIG-803: "existing
-- qualificationData keys are migrated into definitions"). Only top-level keys
-- that are valid field keys and hold plain values; system keys written by the
-- website form (for example "utm") hold objects and stay as they are.
INSERT INTO "custom_field_definitions" ("id", "organization_id", "entity_type", "section", "key", "label", "field_type", "sort_order", "updated_at")
SELECT gen_random_uuid()::text, d."organization_id", 'LEAD', 'QUALIFICATION', d."key",
       initcap(replace(d."key", '_', ' ')), 'TEXT', 1000, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT l."organization_id", e."key"
  FROM "leads" l,
       LATERAL jsonb_each(CASE WHEN jsonb_typeof(l."qualification_data") = 'object' THEN l."qualification_data" ELSE '{}'::jsonb END) AS e("key", "value")
  WHERE jsonb_typeof(e."value") IN ('string', 'number', 'boolean')
    AND e."key" ~ '^[a-z][a-z0-9_]{0,49}$'
) AS d
ON CONFLICT DO NOTHING;
