-- UC-R8 (FIG-1779): payment terms on invoices. Additive only: two nullable columns, no default, no rewrite of existing rows.
--  * payment_terms_days  days from the issue date the customer has to pay (0 to 365). due_on stays required and is still the truth.
--  * terms               the payment terms in words, shown on the invoice.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payment_terms_days" INTEGER;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "terms" TEXT;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_terms_days_chk" CHECK ("payment_terms_days" IS NULL OR ("payment_terms_days" >= 0 AND "payment_terms_days" <= 365));
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_terms_chk" CHECK ("terms" IS NULL OR char_length("terms") <= 2000);
