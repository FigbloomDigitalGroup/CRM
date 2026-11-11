-- Decision 12 (docs/DECISIONS.md 5.0, 5 Nov 2026): there is no Customer Support role and no ticket tables in the CRM.
-- Support tickets are raised by email to Figbloom support through Resend and live in the platform console
-- (docs/SUPPORT_BY_EMAIL.md). This removes what 20261109110000_support_tickets and the seed catalogue added.
--
-- The role was behind the `customer_support.role` flag, off by default, so no real organisation can hold a member with it.
-- The guard below makes that a fact instead of an assumption: it stops the migration if an account that is not a dev or test
-- address (@figbloom.local, or the reserved @example.test the test suite uses) has the role.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM memberships m
    JOIN roles r ON r.id = m.role_id
    JOIN users u ON u.id = m.user_id
    WHERE r.key = 'CUSTOMER_SUPPORT'
      AND u.email NOT LIKE '%@figbloom.local'
      AND u.email NOT LIKE '%@example.test'
  ) THEN
    RAISE EXCEPTION 'A real account still holds the Customer Support role. Move it to another role before this migration runs.';
  END IF;
END $$;

-- The dev-only Customer Support account (prisma/devSeed.ts) and the accounts the test suite made go with the role.
CREATE TEMP TABLE removed_support_users ON COMMIT DROP AS
  SELECT DISTINCT m.user_id AS id
  FROM memberships m
  JOIN roles r ON r.id = m.role_id
  WHERE r.key = 'CUSTOMER_SUPPORT';

-- Records that point at those memberships must not block the delete (FIG-1565: a dev database with tasks assigned to the dev Customer
-- Support user stopped here with a foreign key error). The foreign keys are read from the catalogue, so this covers every table, including
-- ones added after this file was written. For each column that points at a membership being removed:
--   - nullable (owner, creator, author): cleared;
--   - the person's own rows (notifications, notification preferences, page views): deleted;
--   - required (task assignee, deal owner, activity author, handoff creator): handed to the organisation's oldest active Management member;
--   - nothing to hand it to: the row goes, which only dev and test data can reach (the guard above already refused a real account).
CREATE TEMP TABLE removed_support_memberships ON COMMIT DROP AS
  SELECT m.id, m.organization_id
  FROM memberships m
  JOIN roles r ON r.id = m.role_id
  WHERE r.key = 'CUSTOMER_SUPPORT';

DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT c.conrelid::regclass::text AS tbl,
           a.attname::text AS col,
           a.attnotnull AS required,
           EXISTS (SELECT 1 FROM pg_attribute o WHERE o.attrelid = c.conrelid AND o.attname = 'organization_id' AND NOT o.attisdropped) AS has_org
    FROM pg_constraint c
    CROSS JOIN LATERAL unnest(c.conkey, c.confkey) AS k(attnum, refnum)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = k.refnum AND ra.attname = 'id'
    WHERE c.contype = 'f'
      AND c.confrelid = 'memberships'::regclass
      AND c.confdeltype IN ('a', 'r')
    GROUP BY c.conrelid, a.attname, a.attnotnull
  LOOP
    IF NOT fk.required THEN
      EXECUTE format('UPDATE %s SET %I = NULL WHERE %I IN (SELECT id FROM removed_support_memberships)', fk.tbl, fk.col, fk.col);
    ELSIF fk.tbl IN ('notifications', 'notification_preferences', 'page_views') OR NOT fk.has_org THEN
      EXECUTE format('DELETE FROM %s WHERE %I IN (SELECT id FROM removed_support_memberships)', fk.tbl, fk.col);
    ELSE
      EXECUTE format(
        'UPDATE %s t SET %I = h.id FROM (SELECT DISTINCT ON (m.organization_id) m.organization_id, m.id FROM memberships m JOIN roles ro ON ro.id = m.role_id '
        || 'WHERE ro.key = ''MANAGEMENT'' AND m.status = ''ACTIVE'' AND m.id NOT IN (SELECT id FROM removed_support_memberships) ORDER BY m.organization_id, m.created_at) h '
        || 'WHERE t.organization_id = h.organization_id AND t.%I IN (SELECT id FROM removed_support_memberships)',
        fk.tbl, fk.col, fk.col);
      EXECUTE format('DELETE FROM %s WHERE %I IN (SELECT id FROM removed_support_memberships)', fk.tbl, fk.col);
    END IF;
  END LOOP;
END $$;

DELETE FROM memberships WHERE role_id IN (SELECT id FROM roles WHERE key = 'CUSTOMER_SUPPORT');

DELETE FROM users u
WHERE u.id IN (SELECT id FROM removed_support_users)
  AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id);

-- Ticket and survey data (dev and test data only: the tables were never deployed to a production database).
DROP TABLE IF EXISTS "satisfaction_surveys";
DROP TABLE IF EXISTS "ticket_messages";
DROP TABLE IF EXISTS "tickets";

-- The role and the ticket permission.
DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE key = 'tickets.manage');
DELETE FROM permissions WHERE key = 'tickets.manage';
DELETE FROM roles WHERE key = 'CUSTOMER_SUPPORT';

-- The flag that switched the role on, wherever an organisation stored it.
UPDATE organization_settings
SET value = value - 'customer_support.role'
WHERE key = 'feature_toggles' AND value ? 'customer_support.role';

-- The 'SURVEY_RESPONSE' value of "AuthRateLimitAction" stays: PostgreSQL cannot drop an enum value, and it is unused.
