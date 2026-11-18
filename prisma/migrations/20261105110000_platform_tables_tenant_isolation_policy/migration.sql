-- FIG-1136 to FIG-1141 follow-up: the tenant-isolation guard (tests/stage2ExitGate) wants every table that
-- carries an `organization_id` to have row level security enabled and forced and a policy named
-- `tenant_isolation`. Four platform-owned tables carry an organisation id as a plain reference (no
-- foreign key, so the record outlives the organisation). They already have RLS forced and a
-- `platform_access` policy for figbloom_platform only (migration 20261105100000).
--
-- This adds the missing tenant-side wall, stated explicitly: a `tenant_isolation` policy for the tenant
-- application role that matches no row, for reads and writes alike. The tenant role has no table
-- privilege on these tables either (scripts/db-admin.ts revokes it on every grant-role), so this is a
-- second wall, never the only one.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'platform_audit_events', 'organization_lifecycle_events', 'platform_deletion_certificates', 'platform_data_requests'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'figbloom_app') THEN
      EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO figbloom_app USING (false) WITH CHECK (false)', t);
      EXECUTE format('REVOKE ALL ON %I FROM figbloom_app', t);
    ELSE
      EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO PUBLIC USING (false) WITH CHECK (false)', t);
    END IF;
  END LOOP;
END
$$;
