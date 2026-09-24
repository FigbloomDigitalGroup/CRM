-- FIG-438: Tenant-integrity constraints, data-quality CHECKs, row-level
-- security, and audit-event immutability.
--
-- This migration is deliberately hand-written (not Prisma-schema-derived).
-- It adds the database-level guarantees that FIG-437 section 7 and this
-- issue's section 7 call for: tenant isolation must not depend solely on
-- application-layer WHERE clauses.
--
-- Two complementary mechanisms are used:
--
--   1. Composite "tenant-safe" foreign keys: every organization-scoped
--      child table gets an ADDITIONAL foreign key of the shape
--      (organization_id, parent_id) REFERENCES parent(organization_id, id),
--      on top of the plain single-column FK Prisma already created. Because
--      each parent has a UNIQUE (organization_id, id) constraint, this
--      composite FK makes it *impossible* for a row to reference a parent
--      belonging to a different organization -- Postgres rejects the
--      INSERT/UPDATE outright. (Postgres uses MATCH SIMPLE by default, so
--      the check is skipped only when the child's own FK column is NULL,
--      which is correct: an absent reference has nothing to validate.)
--
--   2. Row-level security (RLS): enabled and FORCEd on every
--      organization-scoped table, restricting rows to
--      organization_id = current_setting('app.current_organization_id').
--      This only takes effect for connections that are NOT the table owner
--      and NOT superuser/BYPASSRLS, which is why the application must
--      connect as the dedicated `figbloom_app` role (see
--      scripts/db-admin.ts and README.md) rather than the migration user.
--      Grants to that role are applied defensively (IF EXISTS) so this
--      migration still succeeds in an environment where the role has not
--      been bootstrapped yet.

-- ---------------------------------------------------------------------------
-- 1. Composite tenant-integrity foreign keys
-- ---------------------------------------------------------------------------

-- companies
ALTER TABLE "companies"
  ADD CONSTRAINT "companies_org_lifecycle_state_fk"
  FOREIGN KEY ("organization_id", "lifecycle_state_id")
  REFERENCES "customer_lifecycle_states" ("organization_id", "id");

ALTER TABLE "companies"
  ADD CONSTRAINT "companies_org_owner_membership_fk"
  FOREIGN KEY ("organization_id", "owner_membership_id")
  REFERENCES "memberships" ("organization_id", "id");

ALTER TABLE "companies"
  ADD CONSTRAINT "companies_org_created_by_membership_fk"
  FOREIGN KEY ("organization_id", "created_by_membership_id")
  REFERENCES "memberships" ("organization_id", "id");

-- contacts
ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_org_company_fk"
  FOREIGN KEY ("organization_id", "company_id")
  REFERENCES "companies" ("organization_id", "id");

ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_org_owner_membership_fk"
  FOREIGN KEY ("organization_id", "owner_membership_id")
  REFERENCES "memberships" ("organization_id", "id");

ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_org_created_by_membership_fk"
  FOREIGN KEY ("organization_id", "created_by_membership_id")
  REFERENCES "memberships" ("organization_id", "id");

-- leads
ALTER TABLE "leads"
  ADD CONSTRAINT "leads_org_company_fk"
  FOREIGN KEY ("organization_id", "company_id")
  REFERENCES "companies" ("organization_id", "id");

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_org_contact_fk"
  FOREIGN KEY ("organization_id", "contact_id")
  REFERENCES "contacts" ("organization_id", "id");

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_org_lead_source_fk"
  FOREIGN KEY ("organization_id", "lead_source_id")
  REFERENCES "lead_sources" ("organization_id", "id");

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_org_lead_status_fk"
  FOREIGN KEY ("organization_id", "lead_status_id")
  REFERENCES "lead_statuses" ("organization_id", "id");

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_org_service_interest_fk"
  FOREIGN KEY ("organization_id", "service_interest_id")
  REFERENCES "services" ("organization_id", "id");

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_org_owner_membership_fk"
  FOREIGN KEY ("organization_id", "owner_membership_id")
  REFERENCES "memberships" ("organization_id", "id");

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_org_created_by_membership_fk"
  FOREIGN KEY ("organization_id", "created_by_membership_id")
  REFERENCES "memberships" ("organization_id", "id");

ALTER TABLE "leads"
  ADD CONSTRAINT "leads_org_lost_reason_fk"
  FOREIGN KEY ("organization_id", "lost_reason_id")
  REFERENCES "lost_reasons" ("organization_id", "id");

-- deals
ALTER TABLE "deals"
  ADD CONSTRAINT "deals_org_company_fk"
  FOREIGN KEY ("organization_id", "company_id")
  REFERENCES "companies" ("organization_id", "id");

ALTER TABLE "deals"
  ADD CONSTRAINT "deals_org_primary_contact_fk"
  FOREIGN KEY ("organization_id", "primary_contact_id")
  REFERENCES "contacts" ("organization_id", "id");

ALTER TABLE "deals"
  ADD CONSTRAINT "deals_org_lead_fk"
  FOREIGN KEY ("organization_id", "lead_id")
  REFERENCES "leads" ("organization_id", "id");

ALTER TABLE "deals"
  ADD CONSTRAINT "deals_org_service_fk"
  FOREIGN KEY ("organization_id", "service_id")
  REFERENCES "services" ("organization_id", "id");

ALTER TABLE "deals"
  ADD CONSTRAINT "deals_org_owner_membership_fk"
  FOREIGN KEY ("organization_id", "owner_membership_id")
  REFERENCES "memberships" ("organization_id", "id");

ALTER TABLE "deals"
  ADD CONSTRAINT "deals_org_created_by_membership_fk"
  FOREIGN KEY ("organization_id", "created_by_membership_id")
  REFERENCES "memberships" ("organization_id", "id");

ALTER TABLE "deals"
  ADD CONSTRAINT "deals_org_pipeline_stage_fk"
  FOREIGN KEY ("organization_id", "pipeline_stage_id")
  REFERENCES "pipeline_stages" ("organization_id", "id");

ALTER TABLE "deals"
  ADD CONSTRAINT "deals_org_lost_reason_fk"
  FOREIGN KEY ("organization_id", "lost_reason_id")
  REFERENCES "lost_reasons" ("organization_id", "id");

-- activities
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_org_author_membership_fk"
  FOREIGN KEY ("organization_id", "author_membership_id")
  REFERENCES "memberships" ("organization_id", "id");

ALTER TABLE "activities"
  ADD CONSTRAINT "activities_org_company_fk"
  FOREIGN KEY ("organization_id", "company_id")
  REFERENCES "companies" ("organization_id", "id");

ALTER TABLE "activities"
  ADD CONSTRAINT "activities_org_contact_fk"
  FOREIGN KEY ("organization_id", "contact_id")
  REFERENCES "contacts" ("organization_id", "id");

ALTER TABLE "activities"
  ADD CONSTRAINT "activities_org_lead_fk"
  FOREIGN KEY ("organization_id", "lead_id")
  REFERENCES "leads" ("organization_id", "id");

ALTER TABLE "activities"
  ADD CONSTRAINT "activities_org_deal_fk"
  FOREIGN KEY ("organization_id", "deal_id")
  REFERENCES "deals" ("organization_id", "id");

-- tasks
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_org_assignee_membership_fk"
  FOREIGN KEY ("organization_id", "assignee_membership_id")
  REFERENCES "memberships" ("organization_id", "id");

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_org_created_by_membership_fk"
  FOREIGN KEY ("organization_id", "created_by_membership_id")
  REFERENCES "memberships" ("organization_id", "id");

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_org_company_fk"
  FOREIGN KEY ("organization_id", "company_id")
  REFERENCES "companies" ("organization_id", "id");

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_org_contact_fk"
  FOREIGN KEY ("organization_id", "contact_id")
  REFERENCES "contacts" ("organization_id", "id");

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_org_lead_fk"
  FOREIGN KEY ("organization_id", "lead_id")
  REFERENCES "leads" ("organization_id", "id");

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_org_deal_fk"
  FOREIGN KEY ("organization_id", "deal_id")
  REFERENCES "deals" ("organization_id", "id");

-- communications
ALTER TABLE "communications"
  ADD CONSTRAINT "communications_org_author_membership_fk"
  FOREIGN KEY ("organization_id", "author_membership_id")
  REFERENCES "memberships" ("organization_id", "id");

ALTER TABLE "communications"
  ADD CONSTRAINT "communications_org_activity_fk"
  FOREIGN KEY ("organization_id", "activity_id")
  REFERENCES "activities" ("organization_id", "id");

ALTER TABLE "communications"
  ADD CONSTRAINT "communications_org_company_fk"
  FOREIGN KEY ("organization_id", "company_id")
  REFERENCES "companies" ("organization_id", "id");

ALTER TABLE "communications"
  ADD CONSTRAINT "communications_org_contact_fk"
  FOREIGN KEY ("organization_id", "contact_id")
  REFERENCES "contacts" ("organization_id", "id");

ALTER TABLE "communications"
  ADD CONSTRAINT "communications_org_lead_fk"
  FOREIGN KEY ("organization_id", "lead_id")
  REFERENCES "leads" ("organization_id", "id");

ALTER TABLE "communications"
  ADD CONSTRAINT "communications_org_deal_fk"
  FOREIGN KEY ("organization_id", "deal_id")
  REFERENCES "deals" ("organization_id", "id");

-- proposal_references
ALTER TABLE "proposal_references"
  ADD CONSTRAINT "proposal_references_org_deal_fk"
  FOREIGN KEY ("organization_id", "deal_id")
  REFERENCES "deals" ("organization_id", "id");

ALTER TABLE "proposal_references"
  ADD CONSTRAINT "proposal_references_org_owner_membership_fk"
  FOREIGN KEY ("organization_id", "owner_membership_id")
  REFERENCES "memberships" ("organization_id", "id");

-- company_services
ALTER TABLE "company_services"
  ADD CONSTRAINT "company_services_org_company_fk"
  FOREIGN KEY ("organization_id", "company_id")
  REFERENCES "companies" ("organization_id", "id");

ALTER TABLE "company_services"
  ADD CONSTRAINT "company_services_org_service_fk"
  FOREIGN KEY ("organization_id", "service_id")
  REFERENCES "services" ("organization_id", "id");

-- audit_events (organization_id and actor_membership_id are both nullable;
-- MATCH SIMPLE means the FK is only checked when both are present, so we
-- close the gap with an explicit CHECK below).
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_org_actor_membership_fk"
  FOREIGN KEY ("organization_id", "actor_membership_id")
  REFERENCES "memberships" ("organization_id", "id");

ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_actor_membership_requires_org_chk"
  CHECK ("actor_membership_id" IS NULL OR "organization_id" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 2. Data-quality / business-invariant CHECK constraints
-- ---------------------------------------------------------------------------

-- Activities and communications are relationship-timeline entries: an entry
-- attached to nothing is meaningless. (Tasks are deliberately NOT
-- constrained this way -- a task may be a standalone personal reminder with
-- no linked CRM record.)
ALTER TABLE "activities"
  ADD CONSTRAINT "activities_has_subject_chk"
  CHECK (
    "company_id" IS NOT NULL OR "contact_id" IS NOT NULL OR
    "lead_id" IS NOT NULL OR "deal_id" IS NOT NULL
  );

ALTER TABLE "communications"
  ADD CONSTRAINT "communications_has_subject_chk"
  CHECK (
    "company_id" IS NOT NULL OR "contact_id" IS NOT NULL OR
    "lead_id" IS NOT NULL OR "deal_id" IS NOT NULL
  );

-- A deal marked WON/LOST must carry the corresponding timestamp, and a LOST
-- deal must record why (FIG-297 section 7 "Are reasons for lost deals
-- recorded?"). DealOutcome is a fixed native enum (unlike the org-configurable
-- LeadStatus), so it is safe to check against directly here.
ALTER TABLE "deals"
  ADD CONSTRAINT "deals_outcome_consistency_chk"
  CHECK (
    ("outcome" = 'OPEN') OR
    ("outcome" = 'WON' AND "won_at" IS NOT NULL) OR
    ("outcome" = 'LOST' AND "lost_at" IS NOT NULL AND "lost_reason_id" IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- 3. Row-level security
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'memberships', 'organization_settings',
    'lead_sources', 'lead_statuses', 'pipeline_stages',
    'customer_lifecycle_states', 'lost_reasons', 'services',
    'companies', 'contacts', 'leads', 'deals',
    'activities', 'tasks', 'communications',
    'proposal_references', 'company_services'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (organization_id = current_setting(''app.current_organization_id'', true))
         WITH CHECK (organization_id = current_setting(''app.current_organization_id'', true));',
      tbl
    );
  END LOOP;
END
$$;

-- audit_events: organization_id is nullable (platform-level events), so the
-- policy allows a row through when either it matches the active
-- organization, or (read-only) it has no organization at all. Application
-- code is still expected to scope audit queries by organization explicitly;
-- this policy is the defense-in-depth backstop, not the primary filter.
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_events"
  USING (
    organization_id = current_setting('app.current_organization_id', true)
    OR organization_id IS NULL
  )
  WITH CHECK (
    organization_id = current_setting('app.current_organization_id', true)
  );

-- Organizations themselves: a membership-bearing connection may only see the
-- organization(s) it is actively scoped to; row is visible when its id
-- matches the active organization context.
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "organizations"
  USING (id = current_setting('app.current_organization_id', true));

-- Global catalogs (users, roles, permissions, role_permissions) are
-- intentionally NOT organization-scoped and have no RLS policy: they are
-- either the global identity table (users) or fixed system catalogs (roles,
-- permissions) that every organization context is allowed to read.

-- ---------------------------------------------------------------------------
-- 4. Dedicated, least-privilege application role
-- ---------------------------------------------------------------------------
--
-- RLS has no effect on the table owner or a superuser, so the application
-- must connect as a distinct, non-superuser role for isolation to actually
-- be enforced. That role's password is never stored in migrations/source
-- control -- it is created (or updated) by `npm run db:bootstrap-role`,
-- which reads APP_DB_PASSWORD from the environment (see scripts/db-admin.ts
-- and README.md). This migration only grants privileges to the role BY
-- NAME, and does so defensively so the migration still succeeds if the role
-- has not been bootstrapped yet in this environment.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'figbloom_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO figbloom_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO figbloom_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO figbloom_app';
    -- Audit events are append-only for every ordinary application role:
    -- allow INSERT/SELECT, but never UPDATE/DELETE.
    EXECUTE 'REVOKE UPDATE, DELETE ON "audit_events" FROM figbloom_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO figbloom_app';
  ELSE
    RAISE NOTICE 'Role "figbloom_app" does not exist yet -- run "npm run db:bootstrap-role" then "npm run db:grant-role" to finish granting privileges.';
  END IF;
END
$$;
