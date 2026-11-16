-- P2-26 (FIG-1680): CSV import and export for every role, through the permission model.
-- Delivery, Finance and Restricted Technical cannot see leads, so they get no leads import or export (the key would do nothing).
-- Mirrors ROLE_PERMISSIONS in prisma/seedData.ts for the five platform roles so a database that is migrated but not re-seeded
-- changes too. Additive and idempotent: it only inserts links that are missing, never removes one. Custom roles are untouched
-- (Management grants them in Settings, Roles). Export stays scoped and masked by the services; imports need the create right too.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM (VALUES
  ('SALES', 'leads.export'), ('SALES', 'leads.import'),
  ('SALES', 'contacts.export'), ('SALES', 'contacts.import'),
  ('SALES', 'companies.export'), ('SALES', 'companies.import'),
  ('SALES', 'deals.export'),
  ('DELIVERY', 'contacts.export'), ('DELIVERY', 'companies.export'), ('DELIVERY', 'deals.export'),
  ('FINANCE', 'contacts.export'), ('FINANCE', 'companies.export'), ('FINANCE', 'deals.export')
) AS v("role_key", "permission_key")
JOIN "roles" r ON r."key" = v."role_key" AND r."organization_id" IS NULL
JOIN "permissions" p ON p."key" = v."permission_key"
ON CONFLICT DO NOTHING;
