-- UC-C7 (FIG-1791) and UC-R10 (FIG-1781): the Marketing platform role, the Social keys, and the two invoice keys that open the Sales draft
-- Invoices page. Mirrors ROLES and ROLE_PERMISSIONS in prisma/seedData.ts so a database that is migrated but not re-seeded gets them too
-- (the same precedent as 20261128110000_quote_invoice_permission_keys). Additive and idempotent: it only inserts rows that are missing.
-- Custom roles (roles with an organization_id) are not touched.

INSERT INTO "roles" ("id", "key", "name", "description", "is_system", "updated_at")
SELECT gen_random_uuid()::text, 'MARKETING', 'Marketing', 'Lead sourcing, campaigns and the Social workspace. No deal values, payments or invoices.', true, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "key" = 'MARKETING');

INSERT INTO "permissions" ("id", "key", "area", "description")
SELECT gen_random_uuid()::text, v."key", v."area", v."description"
FROM (VALUES
  ('social.view', 'Social', 'See the Social workspace: overview, inbox, campaigns and analytics.'),
  ('social.publish', 'Social', 'Compose, schedule and publish social posts.')
) AS v("key", "area", "description")
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM (VALUES
  ('MANAGEMENT', 'social.view'), ('MANAGEMENT', 'social.publish'),
  ('SALES', 'invoices.view'), ('SALES', 'invoices.create'),
  ('MARKETING', 'leads.view.own'), ('MARKETING', 'leads.create'), ('MARKETING', 'leads.edit.own'),
  ('MARKETING', 'contacts.view'), ('MARKETING', 'companies.view'),
  ('MARKETING', 'activities.create'), ('MARKETING', 'activities.view'),
  ('MARKETING', 'communications.view'), ('MARKETING', 'communications.create'),
  ('MARKETING', 'tasks.create'), ('MARKETING', 'tasks.assign.own'), ('MARKETING', 'tasks.view.own'),
  ('MARKETING', 'reporting.view.own'), ('MARKETING', 'meetings.schedule'),
  ('MARKETING', 'chat.view'), ('MARKETING', 'chat.post'),
  ('MARKETING', 'social.view'), ('MARKETING', 'social.publish')
) AS v("role_key", "permission_key")
JOIN "roles" r ON r."key" = v."role_key" AND r."organization_id" IS NULL
JOIN "permissions" p ON p."key" = v."permission_key"
ON CONFLICT DO NOTHING;
