-- UC-R1 (FIG-1775): split the quote and invoice permissions without changing any role's current access.
-- Adds ten keys to the global catalogue and links them to the five platform roles, mirroring ROLE_PERMISSIONS in
-- prisma/seedData.ts so a database that is migrated but not re-seeded gets them too (the same precedent as
-- 20261127130000_import_export_all_roles). Additive and idempotent: it only inserts rows that are missing and never removes,
-- renames or rewrites anything. Nothing enforces the new keys yet (UC-R2 onward).
--
-- Custom roles (roles with an organization_id) are NOT touched. They keep exactly the keys they store; the finer keys are
-- derived at read time from the compatibility table PERMISSION_IMPLICATIONS (quotes.create implies quotes.view, quotes.edit and
-- quotes.send; finance.manage.payments implies the invoice, payment-record and export keys; finance.view.payments implies
-- invoices.view and finance.reports.view), so no custom role gains or loses anything by this migration.

INSERT INTO "permissions" ("id", "key", "area", "description")
SELECT gen_random_uuid()::text, v."key", v."area", v."description"
FROM (VALUES
  ('quotes.view', 'Quotes', 'See the quotes list and open a quote.'),
  ('quotes.edit', 'Quotes', 'Edit a quote that has not been sent.'),
  ('quotes.send', 'Quotes', 'Send a quote to the customer by email or share link.'),
  ('invoices.view', 'Finance', 'See the invoices list and open an invoice.'),
  ('invoices.create', 'Finance', 'Create an invoice.'),
  ('invoices.edit', 'Finance', 'Edit or void an invoice.'),
  ('invoices.send', 'Finance', 'Send an invoice to the customer.'),
  ('payments.record', 'Finance', 'Record or reverse a payment against an invoice. Nothing is processed.'),
  ('finance.reports.view', 'Finance', 'See the finance reports.'),
  ('finance.export', 'Finance', 'Export invoices and payments. More than 500 rows still needs export.bulk.')
) AS v("key", "area", "description")
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM (VALUES
  ('MANAGEMENT', 'quotes.view'), ('MANAGEMENT', 'quotes.edit'), ('MANAGEMENT', 'quotes.send'),
  ('MANAGEMENT', 'invoices.view'), ('MANAGEMENT', 'invoices.create'), ('MANAGEMENT', 'invoices.edit'), ('MANAGEMENT', 'invoices.send'),
  ('MANAGEMENT', 'payments.record'), ('MANAGEMENT', 'finance.reports.view'), ('MANAGEMENT', 'finance.export'),
  ('SALES', 'quotes.view'), ('SALES', 'quotes.edit'), ('SALES', 'quotes.send'),
  ('FINANCE', 'quotes.view'),
  ('FINANCE', 'invoices.view'), ('FINANCE', 'invoices.create'), ('FINANCE', 'invoices.edit'), ('FINANCE', 'invoices.send'),
  ('FINANCE', 'payments.record'), ('FINANCE', 'finance.reports.view'), ('FINANCE', 'finance.export')
) AS v("role_key", "permission_key")
JOIN "roles" r ON r."key" = v."role_key" AND r."organization_id" IS NULL
JOIN "permissions" p ON p."key" = v."permission_key"
ON CONFLICT DO NOTHING;
