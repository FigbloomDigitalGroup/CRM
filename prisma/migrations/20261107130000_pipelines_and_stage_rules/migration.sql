-- FIG-1147 (B6.15): more than one pipeline, and rules per stage that block a move and say why.
--
-- pipelines          named, ordered sets of stages; exactly one default per organisation
-- pipeline_services  which services a pipeline is used for
-- stage_rules        QUOTE_REQUIRED, REQUIRED_FIELDS, APPROVAL_REQUIRED on a stage
--
-- Existing deals migrate without a change in behaviour: every organisation gets one default pipeline, every existing stage joins
-- it, and no stage has a rule (except where an organisation had already switched on "Proposal Sent needs a valid quote", B6.11,
-- which becomes the same rule on that stage). A trigger puts any stage created without a pipeline into the default pipeline
-- (creating that pipeline first for a new organisation), so every V1 way of making a stage keeps working.

CREATE TABLE "pipelines" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pipelines_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 80),
    CONSTRAINT "pipelines_default_active_check" CHECK (NOT "is_default" OR "is_active")
);

CREATE UNIQUE INDEX "pipelines_organization_id_id_key" ON "pipelines"("organization_id", "id");
CREATE UNIQUE INDEX "pipelines_organization_id_key_key" ON "pipelines"("organization_id", "key");
CREATE UNIQUE INDEX "pipelines_org_lower_name_key" ON "pipelines"("organization_id", lower("name"));
CREATE UNIQUE INDEX "pipelines_one_default_key" ON "pipelines"("organization_id") WHERE "is_default";

CREATE TABLE "pipeline_services" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_services_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pipeline_services_org_service_key" ON "pipeline_services"("organization_id", "service_id");
CREATE INDEX "pipeline_services_org_pipeline_idx" ON "pipeline_services"("organization_id", "pipeline_id");

CREATE TABLE "stage_rules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "stage_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stage_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stage_rules_type_check" CHECK ("type" IN ('QUOTE_REQUIRED', 'REQUIRED_FIELDS', 'APPROVAL_REQUIRED'))
);

CREATE UNIQUE INDEX "stage_rules_stage_id_type_key" ON "stage_rules"("stage_id", "type");
CREATE INDEX "stage_rules_organization_id_stage_id_idx" ON "stage_rules"("organization_id", "stage_id");

-- 1. The default pipeline for every organisation that has stages, and every stage into it.
ALTER TABLE "pipeline_stages" ADD COLUMN "pipeline_id" TEXT;

INSERT INTO "pipelines" ("id", "organization_id", "key", "name", "is_default", "is_active", "sequence", "updated_at")
SELECT gen_random_uuid()::text, o."id", 'DEFAULT', 'Sales', true, true, 0, CURRENT_TIMESTAMP
FROM "organizations" o;

UPDATE "pipeline_stages" s SET "pipeline_id" = p."id"
FROM "pipelines" p
WHERE p."organization_id" = s."organization_id" AND p."is_default";

ALTER TABLE "pipeline_stages" ALTER COLUMN "pipeline_id" SET NOT NULL;
CREATE INDEX "pipeline_stages_org_pipeline_idx" ON "pipeline_stages"("organization_id", "pipeline_id");

-- 2. Foreign keys, composite so a row can only point at a row of its own organisation.
ALTER TABLE "pipelines"
  ADD CONSTRAINT "pipelines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pipeline_stages"
  ADD CONSTRAINT "pipeline_stages_org_pipeline_fk" FOREIGN KEY ("organization_id", "pipeline_id") REFERENCES "pipelines" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "pipeline_services"
  ADD CONSTRAINT "pipeline_services_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pipeline_services"
  ADD CONSTRAINT "pipeline_services_org_pipeline_fk" FOREIGN KEY ("organization_id", "pipeline_id") REFERENCES "pipelines" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "pipeline_services"
  ADD CONSTRAINT "pipeline_services_org_service_fk" FOREIGN KEY ("organization_id", "service_id") REFERENCES "services" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "stage_rules"
  ADD CONSTRAINT "stage_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stage_rules"
  ADD CONSTRAINT "stage_rules_org_stage_fk" FOREIGN KEY ("organization_id", "stage_id") REFERENCES "pipeline_stages" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "stage_rules"
  ADD CONSTRAINT "stage_rules_org_created_by_fk" FOREIGN KEY ("organization_id", "created_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("created_by_membership_id");

-- 3. Row-level security, forced, like every tenant table.
ALTER TABLE "pipelines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipelines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pipelines"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
ALTER TABLE "pipeline_services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_services" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pipeline_services"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
ALTER TABLE "stage_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stage_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stage_rules"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

-- 4. A stage created without a pipeline joins the organisation's default pipeline (made first when the organisation has none).
--    SECURITY DEFINER so the lookup and the creation work whichever role inserts the stage; it only ever touches the
--    organisation named on the new stage row.
CREATE FUNCTION pipeline_stages_default_pipeline() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  default_id TEXT;
BEGIN
  IF NEW.pipeline_id IS NULL THEN
    SELECT id INTO default_id FROM pipelines WHERE organization_id = NEW.organization_id AND is_default;
    IF default_id IS NULL THEN
      default_id := gen_random_uuid()::text;
      INSERT INTO pipelines (id, organization_id, key, name, is_default, is_active, sequence, updated_at)
      VALUES (default_id, NEW.organization_id, 'DEFAULT', 'Sales', true, true, 0, CURRENT_TIMESTAMP);
    END IF;
    NEW.pipeline_id := default_id;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER pipeline_stages_default_pipeline BEFORE INSERT ON "pipeline_stages"
  FOR EACH ROW EXECUTE FUNCTION pipeline_stages_default_pipeline();

-- Organisations created from now on get their default pipeline together with the organisation.
CREATE FUNCTION organizations_default_pipeline() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO pipelines (id, organization_id, key, name, is_default, is_active, sequence, updated_at)
  VALUES (gen_random_uuid()::text, NEW.id, 'DEFAULT', 'Sales', true, true, 0, CURRENT_TIMESTAMP);
  RETURN NEW;
END
$$;

CREATE TRIGGER organizations_default_pipeline AFTER INSERT ON "organizations"
  FOR EACH ROW EXECUTE FUNCTION organizations_default_pipeline();

-- 5. "Proposal Sent needs a valid quote" (B6.11 organisation setting) becomes the same rule on that stage.
INSERT INTO "stage_rules" ("id", "organization_id", "stage_id", "type", "enabled", "config", "updated_at")
SELECT gen_random_uuid()::text, s."organization_id", s."id", 'QUOTE_REQUIRED', true, '{}'::jsonb, CURRENT_TIMESTAMP
FROM "pipeline_stages" s
JOIN "organization_settings" os ON os."organization_id" = s."organization_id" AND os."key" = 'quotes.settings'
WHERE s."key" = 'PROPOSAL_SENT' AND (os."value"->>'requireForProposalSent') = 'true';
