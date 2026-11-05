-- FIG-1150 (B6.18): follow-up sequences and the enrolment engine.
-- Hand-written, same reasoning as the other composite tenant foreign keys.

CREATE TABLE "follow_up_sequences" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "subject_type" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'MANUAL',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "exit_rules" TEXT[] DEFAULT ARRAY['CLOSED', 'ARCHIVED']::TEXT[],
    "created_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_up_sequences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "follow_up_sequences_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 80),
    CONSTRAINT "follow_up_sequences_subject_check" CHECK ("subject_type" IN ('LEAD', 'DEAL')),
    CONSTRAINT "follow_up_sequences_trigger_check" CHECK ("trigger" IN ('MANUAL', 'WEBSITE_LEAD')),
    -- Only a lead sequence can start from a new website lead.
    CONSTRAINT "follow_up_sequences_trigger_subject_check" CHECK ("trigger" = 'MANUAL' OR "subject_type" = 'LEAD')
);

CREATE UNIQUE INDEX "follow_up_sequences_organization_id_id_key" ON "follow_up_sequences"("organization_id", "id");
CREATE UNIQUE INDEX "follow_up_sequences_org_lower_name_key" ON "follow_up_sequences"("organization_id", lower("name"));
CREATE INDEX "follow_up_sequences_organization_id_is_active_idx" ON "follow_up_sequences"("organization_id", "is_active");

ALTER TABLE "follow_up_sequences"
  ADD CONSTRAINT "follow_up_sequences_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follow_up_sequences"
  ADD CONSTRAINT "follow_up_sequences_org_created_by_fk"
  FOREIGN KEY ("organization_id", "created_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("created_by_membership_id");

CREATE TABLE "follow_up_steps" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "sequence_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "day_offset" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "email_template_id" TEXT,
    "email_mode" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_up_steps_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "follow_up_steps_position_check" CHECK ("position" >= 0),
    CONSTRAINT "follow_up_steps_day_check" CHECK ("day_offset" BETWEEN 0 AND 365),
    CONSTRAINT "follow_up_steps_kind_check" CHECK ("kind" IN ('TASK', 'EMAIL')),
    CONSTRAINT "follow_up_steps_priority_check" CHECK ("priority" IN ('LOW', 'MEDIUM', 'HIGH')),
    CONSTRAINT "follow_up_steps_mode_check" CHECK ("email_mode" IN ('DRAFT', 'SEND')),
    CONSTRAINT "follow_up_steps_email_template_check" CHECK ("kind" = 'TASK' OR "email_template_id" IS NOT NULL)
);

CREATE UNIQUE INDEX "follow_up_steps_sequence_id_position_key" ON "follow_up_steps"("sequence_id", "position");
CREATE INDEX "follow_up_steps_organization_id_sequence_id_idx" ON "follow_up_steps"("organization_id", "sequence_id");

ALTER TABLE "follow_up_steps"
  ADD CONSTRAINT "follow_up_steps_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follow_up_steps"
  ADD CONSTRAINT "follow_up_steps_org_sequence_fk"
  FOREIGN KEY ("organization_id", "sequence_id") REFERENCES "follow_up_sequences" ("organization_id", "id") ON DELETE CASCADE;
-- A template in use by a step cannot be deleted; switch it off instead.
ALTER TABLE "follow_up_steps"
  ADD CONSTRAINT "follow_up_steps_org_template_fk"
  FOREIGN KEY ("organization_id", "email_template_id") REFERENCES "email_templates" ("organization_id", "id") ON DELETE RESTRICT;

CREATE TABLE "follow_up_enrollments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "sequence_id" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "lead_id" TEXT,
    "deal_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "next_position" INTEGER NOT NULL DEFAULT 0,
    "next_run_at" TIMESTAMP(3),
    "enrolled_by_membership_id" TEXT,
    "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "schedule_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_step_at" TIMESTAMP(3),
    "paused_at" TIMESTAMP(3),
    "pause_reason" TEXT,
    "ended_at" TIMESTAMP(3),
    "end_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_up_enrollments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "follow_up_enrollments_status_check" CHECK ("status" IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'EXITED')),
    CONSTRAINT "follow_up_enrollments_subject_check" CHECK (
      ("subject_type" = 'LEAD' AND "lead_id" IS NOT NULL AND "deal_id" IS NULL) OR
      ("subject_type" = 'DEAL' AND "deal_id" IS NOT NULL AND "lead_id" IS NULL)
    )
);

CREATE UNIQUE INDEX "follow_up_enrollments_organization_id_id_key" ON "follow_up_enrollments"("organization_id", "id");
-- One running enrolment per sequence and record.
CREATE UNIQUE INDEX "follow_up_enrollments_one_open_lead_key" ON "follow_up_enrollments"("sequence_id", "lead_id") WHERE "lead_id" IS NOT NULL AND "status" IN ('ACTIVE', 'PAUSED');
CREATE UNIQUE INDEX "follow_up_enrollments_one_open_deal_key" ON "follow_up_enrollments"("sequence_id", "deal_id") WHERE "deal_id" IS NOT NULL AND "status" IN ('ACTIVE', 'PAUSED');
CREATE INDEX "follow_up_enrollments_organization_id_status_next_run_at_idx" ON "follow_up_enrollments"("organization_id", "status", "next_run_at");
CREATE INDEX "follow_up_enrollments_organization_id_lead_id_idx" ON "follow_up_enrollments"("organization_id", "lead_id");
CREATE INDEX "follow_up_enrollments_organization_id_deal_id_idx" ON "follow_up_enrollments"("organization_id", "deal_id");

ALTER TABLE "follow_up_enrollments"
  ADD CONSTRAINT "follow_up_enrollments_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follow_up_enrollments"
  ADD CONSTRAINT "follow_up_enrollments_org_sequence_fk"
  FOREIGN KEY ("organization_id", "sequence_id") REFERENCES "follow_up_sequences" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "follow_up_enrollments"
  ADD CONSTRAINT "follow_up_enrollments_org_lead_fk"
  FOREIGN KEY ("organization_id", "lead_id") REFERENCES "leads" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "follow_up_enrollments"
  ADD CONSTRAINT "follow_up_enrollments_org_deal_fk"
  FOREIGN KEY ("organization_id", "deal_id") REFERENCES "deals" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "follow_up_enrollments"
  ADD CONSTRAINT "follow_up_enrollments_org_enrolled_by_fk"
  FOREIGN KEY ("organization_id", "enrolled_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("enrolled_by_membership_id");

-- The run log points at a communication through the organisation-scoped key, so that key must exist.
CREATE UNIQUE INDEX IF NOT EXISTS "communications_organization_id_id_key" ON "communications"("organization_id", "id");

CREATE TABLE "follow_up_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "position" INTEGER,
    "outcome" TEXT,
    "result" TEXT NOT NULL,
    "task_id" TEXT,
    "communication_id" TEXT,
    "actor_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_up_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "follow_up_runs_kind_check" CHECK ("kind" IN ('ENROL', 'STEP', 'PAUSE', 'RESUME', 'EXIT')),
    CONSTRAINT "follow_up_runs_outcome_check" CHECK ("outcome" IS NULL OR "outcome" IN ('PENDING', 'DONE', 'SKIPPED', 'FAILED')),
    CONSTRAINT "follow_up_runs_step_check" CHECK ("kind" <> 'STEP' OR ("position" IS NOT NULL AND "outcome" IS NOT NULL))
);

-- A step runs once per enrolment: a second worker finds the claim and does nothing.
CREATE UNIQUE INDEX "follow_up_runs_one_step_key" ON "follow_up_runs"("enrollment_id", "position") WHERE "kind" = 'STEP';
CREATE INDEX "follow_up_runs_organization_id_enrollment_id_created_at_idx" ON "follow_up_runs"("organization_id", "enrollment_id", "created_at");

ALTER TABLE "follow_up_runs"
  ADD CONSTRAINT "follow_up_runs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "follow_up_runs"
  ADD CONSTRAINT "follow_up_runs_org_enrollment_fk"
  FOREIGN KEY ("organization_id", "enrollment_id") REFERENCES "follow_up_enrollments" ("organization_id", "id") ON DELETE CASCADE;
-- Deleting a task or a communication keeps the log row.
ALTER TABLE "follow_up_runs"
  ADD CONSTRAINT "follow_up_runs_org_task_fk"
  FOREIGN KEY ("organization_id", "task_id") REFERENCES "tasks" ("organization_id", "id") ON DELETE SET NULL ("task_id");
ALTER TABLE "follow_up_runs"
  ADD CONSTRAINT "follow_up_runs_org_communication_fk"
  FOREIGN KEY ("organization_id", "communication_id") REFERENCES "communications" ("organization_id", "id") ON DELETE SET NULL ("communication_id");
ALTER TABLE "follow_up_runs"
  ADD CONSTRAINT "follow_up_runs_org_actor_fk"
  FOREIGN KEY ("organization_id", "actor_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("actor_membership_id");

ALTER TABLE "follow_up_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "follow_up_sequences" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "follow_up_sequences"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "follow_up_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "follow_up_steps" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "follow_up_steps"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "follow_up_enrollments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "follow_up_enrollments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "follow_up_enrollments"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "follow_up_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "follow_up_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "follow_up_runs"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
