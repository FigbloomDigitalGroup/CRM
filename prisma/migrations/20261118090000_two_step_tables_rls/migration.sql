-- Second wall for the tenant two-step secrets (security review, finding 10).
-- user_two_step, user_backup_codes, user_trusted_devices and two_step_challenges
-- were protected only by REVOKE, which runs only when figbloom_app exists at
-- migration time and is undone by ALTER DEFAULT PRIVILEGES re-grants.
-- RLS is now enabled and forced with NO policy for any application role, so even
-- a re-granted figbloom_app sees and changes no row. The schema owner (the
-- migration role, used by adminDb) keeps access through an owner-only policy,
-- so FORCE cannot lock the service out when the owner is not a superuser.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_two_step', 'user_backup_codes', 'user_trusted_devices', 'two_step_challenges'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS schema_owner_only ON %I', t);
    EXECUTE format('CREATE POLICY schema_owner_only ON %I FOR ALL TO %I USING (true) WITH CHECK (true)', t, current_user);
  END LOOP;
END
$$;
