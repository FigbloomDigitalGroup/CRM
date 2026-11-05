-- FIG-1136, 1137, 1138, 1139, 1141 (B6.04 to B6.09): the platform console backend.
--
-- Everything here is platform-owned: the `figbloom_platform` role gets exactly
-- these tables (and two counts-only views) and nothing from the tenant side.
-- Every table has row-level security forced with a policy for the platform role
-- only; the tenant application role is revoked from all of them (and
-- `npm run db:grant-role` repeats that). Hand-written, like B6.03.
--
-- Platform tables carry organisation ids as plain text, with no foreign key, so
-- the record of what happened to an organisation (the audit log, the lifecycle
-- trail, the deletion certificate) outlives the organisation itself.

-- ---------------------------------------------------------------------------
-- 1. Audit log (B6.06): append-only and tamper-evident.
-- ---------------------------------------------------------------------------
CREATE TABLE "platform_audit_events" (
    "seq" BIGINT NOT NULL,
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT date_trunc('milliseconds', clock_timestamp()),
    "actor_identity_id" TEXT,
    "actor_label" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "organization_id" TEXT,
    "organization_slug" TEXT,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "request_id" TEXT,
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    CONSTRAINT "platform_audit_events_pkey" PRIMARY KEY ("seq")
);
CREATE UNIQUE INDEX "platform_audit_events_id_key" ON "platform_audit_events"("id");
CREATE INDEX "platform_audit_events_action_idx" ON "platform_audit_events"("action", "seq");
CREATE INDEX "platform_audit_events_organization_idx" ON "platform_audit_events"("organization_id", "seq");

-- The hash covers every column except `hash` itself, in a fixed order, plus the
-- previous row's hash. Changing, removing or inserting a row breaks the chain.
CREATE FUNCTION platform_audit_row_hash(
  p_prev TEXT, p_seq BIGINT, p_id TEXT, p_occurred TIMESTAMP, p_actor_id TEXT, p_actor_label TEXT,
  p_action TEXT, p_target_type TEXT, p_target_id TEXT, p_org_id TEXT, p_org_slug TEXT,
  p_reason TEXT, p_metadata JSONB, p_request_id TEXT
) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(
    concat_ws(E'\x1f',
      p_prev, p_seq::text, p_id, to_char(p_occurred, 'YYYY-MM-DD"T"HH24:MI:SS.MS'),
      coalesce(p_actor_id, ''), p_actor_label, p_action, p_target_type, coalesce(p_target_id, ''),
      coalesce(p_org_id, ''), coalesce(p_org_slug, ''), coalesce(p_reason, ''),
      p_metadata::text, coalesce(p_request_id, '')
    ), 'UTF8')), 'hex')
$$;

-- Chains each new row to the one before it. The advisory lock makes inserts
-- one at a time, so `seq` has no gaps and the order is the commit order.
CREATE FUNCTION platform_audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  last_seq BIGINT;
  last_hash TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(7461001);
  SELECT e."seq", e."hash" INTO last_seq, last_hash FROM "platform_audit_events" e ORDER BY e."seq" DESC LIMIT 1;
  NEW."seq" := coalesce(last_seq, 0) + 1;
  NEW."prev_hash" := coalesce(last_hash, 'GENESIS');
  NEW."occurred_at" := date_trunc('milliseconds', clock_timestamp());
  NEW."hash" := platform_audit_row_hash(
    NEW."prev_hash", NEW."seq", NEW."id", NEW."occurred_at", NEW."actor_identity_id", NEW."actor_label",
    NEW."action", NEW."target_type", NEW."target_id", NEW."organization_id", NEW."organization_slug",
    NEW."reason", NEW."metadata", NEW."request_id");
  RETURN NEW;
END
$$;

-- Used by every append-only platform table: no update, no delete, no truncate,
-- for any role. (The schema owner could still drop a trigger; the verification
-- job exists to notice what that would change.)
CREATE FUNCTION platform_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER platform_audit_events_chain BEFORE INSERT ON "platform_audit_events"
  FOR EACH ROW EXECUTE FUNCTION platform_audit_chain();
CREATE TRIGGER platform_audit_events_no_update BEFORE UPDATE OR DELETE ON "platform_audit_events"
  FOR EACH ROW EXECUTE FUNCTION platform_append_only();
CREATE TRIGGER platform_audit_events_no_truncate BEFORE TRUNCATE ON "platform_audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION platform_append_only();

-- One row per verification run. The recorded head lets the next run notice
-- rows cut off the end of the log (which the chain alone cannot show).
CREATE TABLE "platform_audit_verifications" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "rows_checked" INTEGER NOT NULL,
    "head_seq" BIGINT NOT NULL,
    "head_hash" TEXT NOT NULL,
    "first_bad_seq" BIGINT,
    "problem" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'MANUAL',
    CONSTRAINT "platform_audit_verifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_audit_verifications_run_at_idx" ON "platform_audit_verifications"("run_at");
CREATE TRIGGER platform_audit_verifications_no_update BEFORE UPDATE OR DELETE ON "platform_audit_verifications"
  FOR EACH ROW EXECUTE FUNCTION platform_append_only();

-- ---------------------------------------------------------------------------
-- 2. Organisation lifecycle trail (B6.05), also append-only.
-- ---------------------------------------------------------------------------
CREATE TABLE "organization_lifecycle_events" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "organization_id" TEXT NOT NULL,
    "from_status" TEXT NOT NULL,
    "to_status" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actor_identity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_lifecycle_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "organization_lifecycle_events_org_idx" ON "organization_lifecycle_events"("organization_id", "created_at");
CREATE TRIGGER organization_lifecycle_events_no_update BEFORE UPDATE OR DELETE ON "organization_lifecycle_events"
  FOR EACH ROW EXECUTE FUNCTION platform_append_only();

-- ---------------------------------------------------------------------------
-- 3. Idempotency keys for platform creates (provisioning has no organisation yet).
-- ---------------------------------------------------------------------------
CREATE TABLE "platform_idempotency_keys" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "actor_identity_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_idempotency_keys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "platform_idempotency_keys_key" ON "platform_idempotency_keys"("actor_identity_id", "scope", "key");

-- ---------------------------------------------------------------------------
-- 4. Incident markers (B6.07).
-- ---------------------------------------------------------------------------
CREATE TABLE "platform_incidents" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "component" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "created_by_identity_id" TEXT,
    "resolved_by_identity_id" TEXT,
    CONSTRAINT "platform_incidents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_incidents_component_check" CHECK ("component" IN ('API', 'DATABASE', 'JOBS', 'EMAIL', 'STORAGE')),
    CONSTRAINT "platform_incidents_severity_check" CHECK ("severity" IN ('INFO', 'DEGRADED', 'OUTAGE'))
);
CREATE INDEX "platform_incidents_started_at_idx" ON "platform_incidents"("started_at");

-- ---------------------------------------------------------------------------
-- 5. Data requests and offboarding (B6.09).
-- ---------------------------------------------------------------------------
CREATE TABLE "platform_data_requests" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "organization_id" TEXT NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "organization_name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "note" TEXT,
    "requested_by_membership_id" TEXT,
    "requested_by_label" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvals_required" INTEGER NOT NULL,
    "approved_at" TIMESTAMP(3),
    "retention_days" INTEGER NOT NULL DEFAULT 30,
    "delete_after" TIMESTAMP(3),
    "export_status" TEXT NOT NULL DEFAULT 'NONE',
    "export_storage_key" TEXT,
    "export_file_name" TEXT,
    "export_size_bytes" INTEGER,
    "export_checksum_sha256" TEXT,
    "export_table_counts" JSONB,
    "export_ready_at" TIMESTAMP(3),
    "export_expires_at" TIMESTAMP(3),
    "export_purged_at" TIMESTAMP(3),
    "export_error" TEXT,
    "closed_at" TIMESTAMP(3),
    "closed_reason" TEXT,
    "previous_org_status" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_data_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_data_requests_kind_check" CHECK ("kind" IN ('EXPORT', 'DELETE')),
    CONSTRAINT "platform_data_requests_status_check" CHECK ("status" IN ('SUBMITTED', 'APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED')),
    CONSTRAINT "platform_data_requests_export_status_check" CHECK ("export_status" IN ('NONE', 'PACKAGING', 'READY', 'FAILED', 'EXPIRED')),
    CONSTRAINT "platform_data_requests_approvals_check" CHECK ("approvals_required" >= 1)
);
CREATE INDEX "platform_data_requests_org_idx" ON "platform_data_requests"("organization_id", "submitted_at");
CREATE INDEX "platform_data_requests_status_idx" ON "platform_data_requests"("status", "submitted_at");
-- One open request per organisation and kind.
CREATE UNIQUE INDEX "platform_data_requests_open_key" ON "platform_data_requests"("organization_id", "kind")
  WHERE "status" IN ('SUBMITTED', 'APPROVED');

CREATE TABLE "platform_data_request_approvals" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "request_id" TEXT NOT NULL,
    "approver_identity_id" TEXT NOT NULL,
    "approver_label" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "comment" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_data_request_approvals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_data_request_approvals_decision_check" CHECK ("decision" IN ('APPROVE', 'REJECT')),
    CONSTRAINT "platform_data_request_approvals_request_fkey" FOREIGN KEY ("request_id") REFERENCES "platform_data_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- The same person cannot decide twice, which is what makes two approvals two people.
CREATE UNIQUE INDEX "platform_data_request_approvals_once" ON "platform_data_request_approvals"("request_id", "approver_identity_id");
CREATE TRIGGER platform_data_request_approvals_no_update BEFORE UPDATE OR DELETE ON "platform_data_request_approvals"
  FOR EACH ROW EXECUTE FUNCTION platform_append_only();

CREATE TABLE "platform_deletion_certificates" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "request_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "organization_slug" TEXT NOT NULL,
    "organization_name" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by_identity_id" TEXT,
    "content" JSONB NOT NULL,
    "content_sha256" TEXT NOT NULL,
    CONSTRAINT "platform_deletion_certificates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_deletion_certificates_request_fkey" FOREIGN KEY ("request_id") REFERENCES "platform_data_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "platform_deletion_certificates_request_key" ON "platform_deletion_certificates"("request_id");
CREATE TRIGGER platform_deletion_certificates_no_update BEFORE UPDATE OR DELETE ON "platform_deletion_certificates"
  FOR EACH ROW EXECUTE FUNCTION platform_append_only();

-- ---------------------------------------------------------------------------
-- 6. Counts-only views for health (B6.07): numbers, no organisation, no rows.
-- ---------------------------------------------------------------------------
CREATE VIEW "platform_jobs_health" AS
SELECT
  (SELECT count(*) FROM "background_jobs" WHERE "status" = 'QUEUED')  AS queued_count,
  (SELECT count(*) FROM "background_jobs" WHERE "status" = 'RUNNING') AS running_count,
  (SELECT count(*) FROM "background_jobs" WHERE "status" = 'DEAD')    AS dead_count,
  (SELECT min("run_at") FROM "background_jobs" WHERE "status" = 'QUEUED' AND "run_at" <= now()) AS oldest_due_at,
  (SELECT max("finished_at") FROM "background_jobs" WHERE "status" = 'SUCCEEDED') AS last_succeeded_at;

CREATE VIEW "platform_email_health" AS
SELECT
  (SELECT count(*) FROM "notification_deliveries" WHERE "channel"::text = 'EMAIL' AND "status"::text = 'SENT' AND "sent_at" > now() - interval '24 hours') AS sent_24h,
  (SELECT count(*) FROM "notification_deliveries" WHERE "channel"::text = 'EMAIL' AND "status"::text IN ('FAILED', 'EXHAUSTED') AND "created_at" > now() - interval '24 hours') AS failed_24h,
  (SELECT count(*) FROM "notification_deliveries" WHERE "channel"::text = 'EMAIL' AND "status"::text = 'PENDING' AND "next_attempt_at" < now() - interval '1 hour') AS stuck_count;

-- The organisation detail page (PL4): profile facts and who the owner contact is.
-- Settings and a contact name, no customer records or values.
CREATE VIEW "platform_organization_profile" AS
SELECT
  o."id"                  AS organization_id,
  o."timezone"            AS timezone,
  o."default_currency"    AS default_currency,
  owner.owner_name        AS owner_name,
  owner.owner_email       AS owner_email,
  owner.owner_status      AS owner_status
FROM "organizations" o
LEFT JOIN LATERAL (
  SELECT u."name" AS owner_name, u."email" AS owner_email, m."status"::text AS owner_status
  FROM "memberships" m
  JOIN "roles" r ON r."id" = m."role_id"
  JOIN "users" u ON u."id" = m."user_id"
  WHERE m."organization_id" = o."id" AND r."key" = 'MANAGEMENT' AND m."status"::text IN ('ACTIVE', 'PENDING')
  ORDER BY (m."status"::text = 'ACTIVE') DESC, m."created_at"
  LIMIT 1
) owner ON true;

-- ---------------------------------------------------------------------------
-- 7. Walls: RLS forced with a platform-only policy; tenant role revoked.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'platform_audit_events', 'platform_audit_verifications', 'organization_lifecycle_events',
    'platform_idempotency_keys', 'platform_incidents', 'platform_data_requests',
    'platform_data_request_approvals', 'platform_deletion_certificates'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY platform_access ON %I FOR ALL TO figbloom_platform USING (true) WITH CHECK (true)', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'figbloom_app') THEN
      EXECUTE format('REVOKE ALL ON %I FROM figbloom_app', t);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'figbloom_app') THEN
    EXECUTE 'REVOKE ALL ON "platform_jobs_health", "platform_email_health", "platform_organization_profile" FROM figbloom_app';
  END IF;

  -- Append-only tables: the platform role may add and read, never change or remove.
  EXECUTE 'GRANT SELECT, INSERT ON "platform_audit_events", "platform_audit_verifications", "organization_lifecycle_events", "platform_data_request_approvals", "platform_deletion_certificates" TO figbloom_platform';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "platform_idempotency_keys", "platform_incidents", "platform_data_requests" TO figbloom_platform';
  EXECUTE 'GRANT SELECT ON "platform_jobs_health", "platform_email_health", "platform_organization_profile" TO figbloom_platform';
END
$$;
