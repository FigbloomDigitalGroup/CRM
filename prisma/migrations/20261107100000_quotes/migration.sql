-- FIG-1143 (B6.11): quotes tied to deals, with immutable versions.
--
-- quotes          one per deal: a number and its versions
-- quote_versions  one row per version; editable while DRAFT, locked from submission or send
-- quote_lines     lines with price and cost frozen at the moment they were added
--
-- Immutability is enforced here, not only in the service: once a version has `locked_at`, a trigger refuses any change to
-- its content or its lines, and only the status may move forward along the allowed steps. A locked version cannot be
-- deleted by a statement of its own; rows still go when their deal or organisation is deleted (a cascade).

CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "created_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "quotes_organization_id_id_key" ON "quotes"("organization_id", "id");
CREATE UNIQUE INDEX "quotes_organization_id_number_key" ON "quotes"("organization_id", "number");
CREATE UNIQUE INDEX "quotes_organization_id_deal_id_key" ON "quotes"("organization_id", "deal_id");

CREATE TABLE "quote_versions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "valid_until" DATE NOT NULL,
    "terms" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cost_total" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "locked_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "decided_by_membership_id" TEXT,
    "decision_reason" TEXT,
    "sent_at" TIMESTAMP(3),
    "responded_at" TIMESTAMP(3),
    "created_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quote_versions_status_check" CHECK ("status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT', 'ACCEPTED', 'DECLINED')),
    CONSTRAINT "quote_versions_discount_check" CHECK ("discount_percent" >= 0 AND "discount_percent" <= 100),
    CONSTRAINT "quote_versions_version_check" CHECK ("version" >= 1),
    CONSTRAINT "quote_versions_locked_check" CHECK ("status" = 'DRAFT' OR "locked_at" IS NOT NULL)
);

CREATE UNIQUE INDEX "quote_versions_organization_id_id_key" ON "quote_versions"("organization_id", "id");
CREATE UNIQUE INDEX "quote_versions_quote_id_version_key" ON "quote_versions"("quote_id", "version");
CREATE INDEX "quote_versions_organization_id_status_idx" ON "quote_versions"("organization_id", "status");

CREATE TABLE "quote_lines" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "quote_version_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "catalogue_item_id" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'unit',
    "quantity" DECIMAL(12,2) NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "unit_cost" DECIMAL(14,2),
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "line_total" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quote_lines_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "quote_lines_price_check" CHECK ("unit_price" >= 0 AND ("unit_cost" IS NULL OR "unit_cost" >= 0))
);

CREATE INDEX "quote_lines_quote_version_id_position_idx" ON "quote_lines"("quote_version_id", "position");

-- Foreign keys: composite, so a row can only point at a row of its own organisation.
ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_org_deal_fk" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_org_created_by_fk" FOREIGN KEY ("organization_id", "created_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("created_by_membership_id");

ALTER TABLE "quote_versions"
  ADD CONSTRAINT "quote_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_versions"
  ADD CONSTRAINT "quote_versions_org_quote_fk" FOREIGN KEY ("organization_id", "quote_id") REFERENCES "quotes" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "quote_versions"
  ADD CONSTRAINT "quote_versions_org_created_by_fk" FOREIGN KEY ("organization_id", "created_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("created_by_membership_id");
ALTER TABLE "quote_versions"
  ADD CONSTRAINT "quote_versions_org_decided_by_fk" FOREIGN KEY ("organization_id", "decided_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("decided_by_membership_id");

ALTER TABLE "quote_lines"
  ADD CONSTRAINT "quote_lines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_lines"
  ADD CONSTRAINT "quote_lines_org_version_fk" FOREIGN KEY ("organization_id", "quote_version_id") REFERENCES "quote_versions" ("organization_id", "id") ON DELETE CASCADE;
-- Removing a catalogue item (not offered by the API, which hides instead) keeps the lines that used it.
ALTER TABLE "quote_lines"
  ADD CONSTRAINT "quote_lines_org_catalogue_item_fk" FOREIGN KEY ("organization_id", "catalogue_item_id") REFERENCES "catalogue_items" ("organization_id", "id")
  ON DELETE SET NULL ("catalogue_item_id");

-- Row-level security, forced, like every tenant table.
ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quotes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "quotes"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "quote_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quote_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "quote_versions"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "quote_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quote_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "quote_lines"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

-- Immutability. `pg_trigger_depth() > 1` means the statement came from a foreign-key cascade (a deal or an organisation
-- being deleted), which is allowed; a statement of its own runs at depth 1.

CREATE FUNCTION quote_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.locked_at IS NOT NULL AND pg_trigger_depth() = 1 THEN
      RAISE EXCEPTION 'Quote version % is locked and cannot be deleted.', OLD.version USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.locked_at IS NOT NULL THEN
    IF NEW.locked_at IS DISTINCT FROM OLD.locked_at
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.quote_id IS DISTINCT FROM OLD.quote_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.discount_percent IS DISTINCT FROM OLD.discount_percent
       OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
       OR NEW.terms IS DISTINCT FROM OLD.terms
       OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
       OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
       OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.cost_total IS DISTINCT FROM OLD.cost_total
       OR NEW.currency IS DISTINCT FROM OLD.currency THEN
      RAISE EXCEPTION 'Quote version % is locked: its content cannot change. Make a new version.', OLD.version USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
         (OLD.status = 'PENDING_APPROVAL' AND NEW.status IN ('APPROVED', 'REJECTED'))
      OR (OLD.status = 'APPROVED' AND NEW.status = 'SENT')
      OR (OLD.status = 'SENT' AND NEW.status IN ('ACCEPTED', 'DECLINED'))
    ) THEN
      RAISE EXCEPTION 'Quote version % cannot go from % to %.', OLD.version, OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER quote_versions_guard BEFORE UPDATE OR DELETE ON "quote_versions"
  FOR EACH ROW EXECUTE FUNCTION quote_versions_guard();

CREATE FUNCTION quote_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  locked TIMESTAMP(3);
  target TEXT;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  target := CASE WHEN TG_OP = 'INSERT' THEN NEW.quote_version_id ELSE OLD.quote_version_id END;
  SELECT locked_at INTO locked FROM "quote_versions" WHERE id = target;
  IF locked IS NOT NULL THEN
    RAISE EXCEPTION 'The lines of a locked quote version cannot change. Make a new version.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER quote_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON "quote_lines"
  FOR EACH ROW EXECUTE FUNCTION quote_lines_guard();
