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
