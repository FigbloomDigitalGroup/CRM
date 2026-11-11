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

-- FIG-1565: a dev database can hold work that belongs to those members (tasks assigned to or created by the support
-- account, activities it wrote, deals it owned, its notifications), and the foreign keys to memberships do not cascade.
-- Before the members go, hand that work over: it moves to the first active Management member of the same organisation (else
-- any other active member). A reference that may be empty is cleared instead, and a member's own notification, preference
-- and page-view rows are deleted. The foreign keys are read from the catalogue, so a table added later is covered too.
-- Safe to run twice: with no Customer Support members left, every statement below touches nothing.
CREATE TEMP TABLE support_handover ON COMMIT DROP AS
SELECT s.id AS old_id,
       s.organization_id AS org_id,
       COALESCE(
         (SELECT x.id FROM memberships x JOIN roles xr ON xr.id = x.role_id
           WHERE x.organization_id = s.organization_id AND x.status = 'ACTIVE' AND xr.key = 'MANAGEMENT'
           ORDER BY x.joined_at NULLS LAST, x.created_at, x.id LIMIT 1),
         (SELECT x.id FROM memberships x JOIN roles xr ON xr.id = x.role_id
           WHERE x.organization_id = s.organization_id AND x.status = 'ACTIVE' AND xr.key <> 'CUSTOMER_SUPPORT'
           ORDER BY x.joined_at NULLS LAST, x.created_at, x.id LIMIT 1)
       ) AS new_id
FROM memberships s
JOIN roles sr ON sr.id = s.role_id
WHERE sr.key = 'CUSTOMER_SUPPORT';

DO $$
DECLARE
  fk record;
  stuck_org text;
BEGIN
  FOR fk IN
    SELECT DISTINCT c.conrelid::regclass::text AS tbl, a.attname::text AS col, a.attnotnull AS required
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f'
      AND c.confrelid = 'memberships'::regclass
      AND c.confdeltype IN ('a', 'r')
      AND a.attname <> 'organization_id'
      AND c.conrelid <> 'memberships'::regclass
  LOOP
    IF NOT fk.required THEN
      EXECUTE format('UPDATE %s SET %I = NULL WHERE %I IN (SELECT old_id FROM support_handover)', fk.tbl, fk.col, fk.col);
    ELSIF fk.col = 'membership_id' THEN
      EXECUTE format('DELETE FROM %s WHERE %I IN (SELECT old_id FROM support_handover)', fk.tbl, fk.col);
    ELSE
      EXECUTE format(
        'SELECT h.org_id FROM %s t JOIN support_handover h ON t.%I = h.old_id WHERE h.new_id IS NULL LIMIT 1',
        fk.tbl, fk.col
      ) INTO stuck_org;
      IF stuck_org IS NOT NULL THEN
        RAISE EXCEPTION 'Organisation % has work owned by a Customer Support member (%.%) but no other active member to take it over. Add one before this migration runs.', stuck_org, fk.tbl, fk.col;
      END IF;
      EXECUTE format(
        'UPDATE %s t SET %I = h.new_id FROM support_handover h WHERE t.%I = h.old_id',
        fk.tbl, fk.col, fk.col
      );
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
