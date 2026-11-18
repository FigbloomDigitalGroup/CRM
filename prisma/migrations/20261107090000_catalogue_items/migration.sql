-- FIG-1142 (B6.10): the catalogue of products and services that quotes and deals draw from.
--
-- Price, cost, unit, tax flag and an ACTIVE/HIDDEN state. Cost is permissioned in the service layer (`deals.margin`).

CREATE TABLE "catalogue_items" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'PRODUCT',
    "unit" TEXT NOT NULL DEFAULT 'unit',
    "price" DECIMAL(14,2) NOT NULL,
    "cost" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalogue_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "catalogue_items_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
    CONSTRAINT "catalogue_items_kind_check" CHECK ("kind" IN ('PRODUCT', 'SERVICE')),
    CONSTRAINT "catalogue_items_status_check" CHECK ("status" IN ('ACTIVE', 'HIDDEN')),
    CONSTRAINT "catalogue_items_price_check" CHECK ("price" >= 0),
    CONSTRAINT "catalogue_items_cost_check" CHECK ("cost" IS NULL OR "cost" >= 0)
);

CREATE UNIQUE INDEX "catalogue_items_org_lower_name_key" ON "catalogue_items"("organization_id", lower("name"));
CREATE UNIQUE INDEX "catalogue_items_org_lower_sku_key" ON "catalogue_items"("organization_id", lower("sku")) WHERE "sku" IS NOT NULL;
CREATE UNIQUE INDEX "catalogue_items_organization_id_id_key" ON "catalogue_items"("organization_id", "id");
CREATE INDEX "catalogue_items_organization_id_status_idx" ON "catalogue_items"("organization_id", "status");

ALTER TABLE "catalogue_items"
  ADD CONSTRAINT "catalogue_items_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalogue_items"
  ADD CONSTRAINT "catalogue_items_org_created_by_fk"
  FOREIGN KEY ("organization_id", "created_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("created_by_membership_id");

ALTER TABLE "catalogue_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalogue_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "catalogue_items"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
