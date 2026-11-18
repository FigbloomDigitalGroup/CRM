-- Stage 4 (M4): admin, automation, data and mobile sync.
--
--   B4.01 settings backend      website key grace window, last accepted/rejected, inbound email errors
--   B4.02 automations           automation_rules (on/off, thresholds), automation_runs (the run log)
--   B4.04 data migration        import_sessions, import_mapping_presets, import_session_issues,
--                               import_session_changes; every imported row carries its session id
--   B4.05 data and privacy      data_subject_requests, export_approvals
--   B4.06 reference data admin  tags can be hidden
--   B4.07 offline sync          sync_mutations, push_subscriptions

-- ---------------------------------------------------------------------------
-- 1. Settings (B4.01): the website key keeps working for a grace window after a rotation.
-- ---------------------------------------------------------------------------

ALTER TABLE "website_api_keys"
  ADD COLUMN "previous_key_hash" TEXT,
  ADD COLUMN "previous_key_prefix" TEXT,
  ADD COLUMN "previous_key_expires_at" TIMESTAMP(3),
  ADD COLUMN "last_accepted_at" TIMESTAMP(3),
  ADD COLUMN "last_rejected_at" TIMESTAMP(3),
  ADD COLUMN "rotated_at" TIMESTAMP(3);

ALTER TABLE "inbound_email_keys"
  ADD COLUMN "last_error_at" TIMESTAMP(3),
  ADD COLUMN "last_error" TEXT;

-- ---------------------------------------------------------------------------
-- 2. Automations (B4.02)
-- ---------------------------------------------------------------------------

CREATE TABLE "automation_rules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "rule_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "updated_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automation_rules_org_key_key" ON "automation_rules"("organization_id", "rule_key");

CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "rule_key" TEXT NOT NULL,
    "trigger_key" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "status" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "automation_runs_status_chk" CHECK ("status" IN ('APPLIED', 'SKIPPED', 'FAILED'))
);

-- One effect per trigger: a second APPLIED run for the same trigger cannot exist.
CREATE UNIQUE INDEX "automation_runs_one_effect_key" ON "automation_runs"("organization_id", "rule_key", "trigger_key") WHERE "status" = 'APPLIED';
CREATE INDEX "automation_runs_org_created_idx" ON "automation_runs"("organization_id", "created_at" DESC);
CREATE INDEX "automation_runs_org_rule_created_idx" ON "automation_runs"("organization_id", "rule_key", "created_at" DESC);

ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_org_updated_by_fk" FOREIGN KEY ("organization_id", "updated_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("updated_by_membership_id");
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. Data migration (B4.04, FIG-800)
-- ---------------------------------------------------------------------------

CREATE TABLE "import_sessions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "source_kind" TEXT NOT NULL DEFAULT 'GENERIC',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "step" TEXT NOT NULL DEFAULT 'SOURCE',
    "file_id" TEXT,
    "file_name" TEXT,
    "headers" JSONB NOT NULL DEFAULT '[]',
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "value_mappings" JSONB NOT NULL DEFAULT '{}',
    "duplicate_policy" TEXT NOT NULL DEFAULT 'SKIP',
    "preset_id" TEXT,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "warning_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
    "processed_rows" INTEGER NOT NULL DEFAULT 0,
    "created_rows" INTEGER NOT NULL DEFAULT 0,
    "updated_rows" INTEGER NOT NULL DEFAULT 0,
    "skipped_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "dry_run" JSONB,
    "summary" JSONB,
    "error_file_id" TEXT,
    "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
    "failure_message" TEXT,
    "job_id" TEXT,
    "created_by_membership_id" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "rollback_deadline" TIMESTAMP(3),
    "rolled_back_at" TIMESTAMP(3),
    "rolled_back_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "import_sessions_entity_chk" CHECK ("entity" IN ('LEAD', 'CONTACT', 'COMPANY', 'DEAL', 'TASK', 'ACTIVITY')),
    CONSTRAINT "import_sessions_status_chk" CHECK ("status" IN (
      'DRAFT', 'UPLOADED', 'MAPPED', 'VALIDATED', 'DRY_RUN_DONE', 'QUEUED', 'IMPORTING',
      'COMPLETED', 'COMPLETED_WITH_ERRORS', 'CANCELLED', 'FAILED', 'ROLLED_BACK'
    )),
    CONSTRAINT "import_sessions_step_chk" CHECK ("step" IN ('SOURCE', 'UPLOAD', 'MAP', 'VALIDATE', 'DRY_RUN', 'IMPORT', 'REVIEW')),
    CONSTRAINT "import_sessions_policy_chk" CHECK ("duplicate_policy" IN ('SKIP', 'UPDATE', 'CREATE'))
);

CREATE UNIQUE INDEX "import_sessions_organization_id_id_key" ON "import_sessions"("organization_id", "id");
CREATE INDEX "import_sessions_org_created_idx" ON "import_sessions"("organization_id", "created_at" DESC);

CREATE TABLE "import_mapping_presets" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "value_mappings" JSONB NOT NULL DEFAULT '{}',
    "created_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_mapping_presets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "import_mapping_presets_name_chk" CHECK (char_length(btrim("name")) BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX "import_mapping_presets_org_entity_name_key" ON "import_mapping_presets"("organization_id", "entity", lower("name"));

CREATE TABLE "import_session_issues" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "severity" TEXT NOT NULL,
    "field" TEXT,
    "message" TEXT NOT NULL,
    "matched_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_session_issues_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "import_session_issues_phase_chk" CHECK ("phase" IN ('VALIDATE', 'IMPORT')),
    CONSTRAINT "import_session_issues_severity_chk" CHECK ("severity" IN ('ERROR', 'WARNING', 'DUPLICATE'))
);

CREATE INDEX "import_session_issues_session_idx" ON "import_session_issues"("organization_id", "session_id", "phase", "row_number");

-- What an import did to each record, so a rollback can undo exactly that and nothing else.
CREATE TABLE "import_session_changes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previous" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_session_changes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "import_session_changes_action_chk" CHECK ("action" IN ('CREATED', 'UPDATED'))
);

CREATE INDEX "import_session_changes_session_idx" ON "import_session_changes"("organization_id", "session_id");

ALTER TABLE "import_sessions" ADD CONSTRAINT "import_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_sessions" ADD CONSTRAINT "import_sessions_org_created_by_fk" FOREIGN KEY ("organization_id", "created_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("created_by_membership_id");
ALTER TABLE "import_sessions" ADD CONSTRAINT "import_sessions_org_rolled_back_by_fk" FOREIGN KEY ("organization_id", "rolled_back_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("rolled_back_by_membership_id");
ALTER TABLE "import_mapping_presets" ADD CONSTRAINT "import_mapping_presets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_mapping_presets" ADD CONSTRAINT "import_mapping_presets_org_created_by_fk" FOREIGN KEY ("organization_id", "created_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("created_by_membership_id");
ALTER TABLE "import_session_issues" ADD CONSTRAINT "import_session_issues_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_session_issues" ADD CONSTRAINT "import_session_issues_org_session_fk" FOREIGN KEY ("organization_id", "session_id") REFERENCES "import_sessions" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "import_session_changes" ADD CONSTRAINT "import_session_changes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "import_session_changes" ADD CONSTRAINT "import_session_changes_org_session_fk" FOREIGN KEY ("organization_id", "session_id") REFERENCES "import_sessions" ("organization_id", "id") ON DELETE CASCADE;

-- Every created row is tagged with the session that created it.
ALTER TABLE "leads" ADD COLUMN "import_session_id" TEXT;
ALTER TABLE "contacts" ADD COLUMN "import_session_id" TEXT;
ALTER TABLE "companies" ADD COLUMN "import_session_id" TEXT;
ALTER TABLE "deals" ADD COLUMN "import_session_id" TEXT;
ALTER TABLE "tasks" ADD COLUMN "import_session_id" TEXT;
ALTER TABLE "activities" ADD COLUMN "import_session_id" TEXT;

CREATE INDEX "leads_import_session_idx" ON "leads"("organization_id", "import_session_id") WHERE "import_session_id" IS NOT NULL;
CREATE INDEX "contacts_import_session_idx" ON "contacts"("organization_id", "import_session_id") WHERE "import_session_id" IS NOT NULL;
CREATE INDEX "companies_import_session_idx" ON "companies"("organization_id", "import_session_id") WHERE "import_session_id" IS NOT NULL;
CREATE INDEX "deals_import_session_idx" ON "deals"("organization_id", "import_session_id") WHERE "import_session_id" IS NOT NULL;
CREATE INDEX "tasks_import_session_idx" ON "tasks"("organization_id", "import_session_id") WHERE "import_session_id" IS NOT NULL;
CREATE INDEX "activities_import_session_idx" ON "activities"("organization_id", "import_session_id") WHERE "import_session_id" IS NOT NULL;

ALTER TABLE "leads" ADD CONSTRAINT "leads_org_import_session_fk" FOREIGN KEY ("organization_id", "import_session_id") REFERENCES "import_sessions" ("organization_id", "id") ON DELETE SET NULL ("import_session_id");
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_org_import_session_fk" FOREIGN KEY ("organization_id", "import_session_id") REFERENCES "import_sessions" ("organization_id", "id") ON DELETE SET NULL ("import_session_id");
ALTER TABLE "companies" ADD CONSTRAINT "companies_org_import_session_fk" FOREIGN KEY ("organization_id", "import_session_id") REFERENCES "import_sessions" ("organization_id", "id") ON DELETE SET NULL ("import_session_id");
ALTER TABLE "deals" ADD CONSTRAINT "deals_org_import_session_fk" FOREIGN KEY ("organization_id", "import_session_id") REFERENCES "import_sessions" ("organization_id", "id") ON DELETE SET NULL ("import_session_id");
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_import_session_fk" FOREIGN KEY ("organization_id", "import_session_id") REFERENCES "import_sessions" ("organization_id", "id") ON DELETE SET NULL ("import_session_id");
ALTER TABLE "activities" ADD CONSTRAINT "activities_org_import_session_fk" FOREIGN KEY ("organization_id", "import_session_id") REFERENCES "import_sessions" ("organization_id", "id") ON DELETE SET NULL ("import_session_id");

-- ---------------------------------------------------------------------------
-- 4. Data and privacy (B4.05)
-- ---------------------------------------------------------------------------

-- A person's request about their own data. The row never holds the person's name or contact
-- details after it is closed: `subject_label` is blanked on completion and the audit trail
-- carries a salted hash, not the details.
CREATE TABLE "data_subject_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "contact_id" TEXT,
    "subject_label" TEXT NOT NULL,
    "due_on" DATE NOT NULL,
    "evidence_notes" TEXT,
    "requested_by_membership_id" TEXT,
    "first_confirmed_by_membership_id" TEXT,
    "first_confirmed_at" TIMESTAMP(3),
    "second_confirmed_by_membership_id" TEXT,
    "second_confirmed_at" TIMESTAMP(3),
    "result" JSONB,
    "export_file_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "data_subject_requests_kind_chk" CHECK ("kind" IN ('ACCESS', 'RECTIFICATION', 'ERASURE')),
    CONSTRAINT "data_subject_requests_status_chk" CHECK ("status" IN ('OPEN', 'IN_PROGRESS', 'AWAITING_SECOND_CONFIRMATION', 'COMPLETED', 'REJECTED')),
    CONSTRAINT "data_subject_requests_confirm_chk" CHECK (
      "first_confirmed_by_membership_id" IS NULL
      OR "second_confirmed_by_membership_id" IS NULL
      OR "first_confirmed_by_membership_id" <> "second_confirmed_by_membership_id"
    )
);

CREATE UNIQUE INDEX "data_subject_requests_organization_id_id_key" ON "data_subject_requests"("organization_id", "id");
CREATE INDEX "data_subject_requests_org_status_due_idx" ON "data_subject_requests"("organization_id", "status", "due_on");

ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_org_contact_fk" FOREIGN KEY ("organization_id", "contact_id") REFERENCES "contacts" ("organization_id", "id") ON DELETE SET NULL ("contact_id");
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_org_requested_by_fk" FOREIGN KEY ("organization_id", "requested_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("requested_by_membership_id");
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_org_first_by_fk" FOREIGN KEY ("organization_id", "first_confirmed_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("first_confirmed_by_membership_id");
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_org_second_by_fk" FOREIGN KEY ("organization_id", "second_confirmed_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("second_confirmed_by_membership_id");

-- A bulk export above the organisation's row threshold needs a Management decision first.
CREATE TABLE "export_approvals" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "row_count" INTEGER NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_by_membership_id" TEXT NOT NULL,
    "decided_by_membership_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "expires_at" TIMESTAMP(3),
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_approvals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "export_approvals_status_chk" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'USED'))
);

CREATE UNIQUE INDEX "export_approvals_organization_id_id_key" ON "export_approvals"("organization_id", "id");
CREATE INDEX "export_approvals_org_status_idx" ON "export_approvals"("organization_id", "status", "created_at" DESC);

ALTER TABLE "export_approvals" ADD CONSTRAINT "export_approvals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_approvals" ADD CONSTRAINT "export_approvals_org_requested_by_fk" FOREIGN KEY ("organization_id", "requested_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "export_approvals" ADD CONSTRAINT "export_approvals_org_decided_by_fk" FOREIGN KEY ("organization_id", "decided_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("decided_by_membership_id");

-- ---------------------------------------------------------------------------
-- 5. Reference data admin (B4.06): a tag can be hidden, never lost.
-- ---------------------------------------------------------------------------

ALTER TABLE "tags" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- 6. Offline sync and push (B4.07)
-- ---------------------------------------------------------------------------

CREATE TABLE "sync_mutations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "response" JSONB,
    "request_hash" TEXT NOT NULL,
    "client_created_at" TIMESTAMP(3),
    "batch_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_mutations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sync_mutations_status_chk" CHECK ("status" IN ('APPLIED', 'CONFLICT', 'REJECTED'))
);

CREATE UNIQUE INDEX "sync_mutations_org_member_client_key" ON "sync_mutations"("organization_id", "membership_id", "client_id");
CREATE INDEX "sync_mutations_org_member_created_idx" ON "sync_mutations"("organization_id", "membership_id", "created_at" DESC);

CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_success_at" TIMESTAMP(3),
    "last_failure_at" TIMESTAMP(3),
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "push_subscriptions_endpoint_chk" CHECK (char_length("endpoint") BETWEEN 10 AND 2000)
);

CREATE UNIQUE INDEX "push_subscriptions_org_member_endpoint_key" ON "push_subscriptions"("organization_id", "membership_id", "endpoint");
CREATE INDEX "push_subscriptions_org_member_idx" ON "push_subscriptions"("organization_id", "membership_id") WHERE "revoked_at" IS NULL;

ALTER TABLE "sync_mutations" ADD CONSTRAINT "sync_mutations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sync_mutations" ADD CONSTRAINT "sync_mutations_org_member_fk" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_org_member_fk" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 7. Row-level security, same policy as every tenant table.
-- ---------------------------------------------------------------------------

ALTER TABLE "automation_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "automation_rules"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "automation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "automation_runs"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "import_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "import_sessions"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "import_mapping_presets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_mapping_presets" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "import_mapping_presets"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "import_session_issues" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_session_issues" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "import_session_issues"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "import_session_changes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_session_changes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "import_session_changes"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "data_subject_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_subject_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "data_subject_requests"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "export_approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "export_approvals" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "export_approvals"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "sync_mutations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_mutations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sync_mutations"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "push_subscriptions"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
