-- FIG-1049 (B3.03): Payments tracker. Status only: no amounts are processed, no bank details are stored.
--
--   invoices           an invoice or expected payment, linked to a company and (usually) a won deal
--   payment_records    money received against an invoice (append-only; a mistake is reversed, never deleted)
--   deal_payment_notes the one "next" follow-up note Finance keeps per won deal
--
-- "Overdue" is not stored: it is derived from the due date and the unpaid balance when read.

CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PART_PAID', 'PAID', 'VOID');

CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "deal_id" TEXT,
    "company_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "issued_on" DATE NOT NULL,
    "due_on" DATE NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "allow_overpayment" BOOLEAN NOT NULL DEFAULT false,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "voided_by_membership_id" TEXT,
    "recurring_service_id" TEXT,
    "notes" TEXT,
    "created_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoices_amount_chk" CHECK ("amount" > 0),
    CONSTRAINT "invoices_number_chk" CHECK (char_length(btrim("number")) BETWEEN 1 AND 60),
    CONSTRAINT "invoices_due_after_issue_chk" CHECK ("due_on" >= "issued_on"),
    CONSTRAINT "invoices_void_consistency_chk" CHECK (("status" = 'VOID') = ("voided_at" IS NOT NULL))
);

CREATE UNIQUE INDEX "invoices_organization_id_id_key" ON "invoices"("organization_id", "id");
CREATE UNIQUE INDEX "invoices_org_lower_number_key" ON "invoices"("organization_id", lower("number"));
CREATE INDEX "invoices_organization_id_status_due_on_idx" ON "invoices"("organization_id", "status", "due_on");
CREATE INDEX "invoices_organization_id_deal_id_idx" ON "invoices"("organization_id", "deal_id");
CREATE INDEX "invoices_organization_id_company_id_idx" ON "invoices"("organization_id", "company_id");

CREATE TABLE "payment_records" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_on" DATE NOT NULL,
    "method_label" TEXT,
    "reference" TEXT,
    "recorded_by_membership_id" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reversal_reason" TEXT,
    "reversed_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_records_amount_chk" CHECK ("amount" > 0),
    CONSTRAINT "payment_records_reversal_chk" CHECK (("reversed_at" IS NULL) = ("reversal_reason" IS NULL))
);

CREATE UNIQUE INDEX "payment_records_organization_id_id_key" ON "payment_records"("organization_id", "id");
CREATE INDEX "payment_records_organization_id_invoice_id_idx" ON "payment_records"("organization_id", "invoice_id");
CREATE INDEX "payment_records_organization_id_paid_on_idx" ON "payment_records"("organization_id", "paid_on");

CREATE TABLE "deal_payment_notes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "owner_membership_id" TEXT,
    "next_on" DATE,
    "updated_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deal_payment_notes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "deal_payment_notes_note_chk" CHECK (char_length(btrim("note")) BETWEEN 1 AND 1000)
);

CREATE UNIQUE INDEX "deal_payment_notes_org_deal_key" ON "deal_payment_notes"("organization_id", "deal_id");

-- Tenant integrity: every reference stays inside the organisation.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_deal_fk" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals" ("organization_id", "id") ON DELETE RESTRICT;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_company_fk" FOREIGN KEY ("organization_id", "company_id") REFERENCES "companies" ("organization_id", "id") ON DELETE RESTRICT;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_created_by_fk" FOREIGN KEY ("organization_id", "created_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("created_by_membership_id");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_voided_by_fk" FOREIGN KEY ("organization_id", "voided_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("voided_by_membership_id");

ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_org_invoice_fk" FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices" ("organization_id", "id") ON DELETE RESTRICT;
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_org_recorded_by_fk" FOREIGN KEY ("organization_id", "recorded_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("recorded_by_membership_id");
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_org_reversed_by_fk" FOREIGN KEY ("organization_id", "reversed_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("reversed_by_membership_id");

ALTER TABLE "deal_payment_notes" ADD CONSTRAINT "deal_payment_notes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "deal_payment_notes" ADD CONSTRAINT "deal_payment_notes_org_deal_fk" FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "deal_payment_notes" ADD CONSTRAINT "deal_payment_notes_org_owner_fk" FOREIGN KEY ("organization_id", "owner_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("owner_membership_id");
ALTER TABLE "deal_payment_notes" ADD CONSTRAINT "deal_payment_notes_org_updated_by_fk" FOREIGN KEY ("organization_id", "updated_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("updated_by_membership_id");

-- Row-level security, same policy as every tenant table.
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "invoices"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "payment_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payment_records"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "deal_payment_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "deal_payment_notes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deal_payment_notes"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
