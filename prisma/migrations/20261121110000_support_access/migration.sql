-- FIG-1183 (B7.01): support access (break-glass). A time-boxed, read-only view of one organisation that the organisation's Management approves.
-- Requirements R1 to R12 of docs/SECURITY_REVIEW_PLATFORM_CONSOLE.md, section 5.
--
--   support_access_grants      one row per request: own table (R1). A trigger enforces the state machine for whoever is changing it (the
--                              platform can ask, open and end; only the tenant side can approve or deny), so no application bug can turn a
--                              PENDING request into an ACTIVE one. (R2) The platform role has NO privilege on this table (it carries an
--                              organisation id, so it is a tenant table): it reaches it only through the support_access_* functions below.
--   support_access_page_views  what the support admin looked at. The organisation reads it (OS4); nobody can change or delete a row. (R7)
--   support_access_read()      the one way the platform reads tenant records. SECURITY DEFINER, it names the columns itself (no deal
--                              value, payment, cost, margin, note or file is ever selected), sets the organisation context from the grant
--                              so row-level security applies to the organisation the grant names, and writes the page view. (R4, R5, R6)

CREATE TABLE "support_access_grants" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "requested_by_identity_id" TEXT NOT NULL,
    "requested_by_label" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "ticket_reference" TEXT NOT NULL,
    "scope" TEXT[] NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "unmask_contact_details" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_expires_at" TIMESTAMP(3) NOT NULL,
    "decided_at" TIMESTAMP(3),
    "decided_by_membership_id" TEXT,
    "decided_by_label" TEXT,
    "decision_note" TEXT,
    "opened_at" TIMESTAMP(3),
    "opened_by_identity_id" TEXT,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "ended_by_label" TEXT,
    "end_reason" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_access_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "support_access_grants_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'ACTIVE', 'DENIED', 'ENDED', 'EXPIRED', 'CANCELLED')),
    CONSTRAINT "support_access_grants_duration_check" CHECK ("duration_minutes" IN (30, 60, 120)),
    CONSTRAINT "support_access_grants_scope_check" CHECK (cardinality("scope") BETWEEN 1 AND 5 AND "scope" <@ ARRAY['COMPANIES', 'CONTACTS', 'LEADS', 'DEALS', 'TASKS']::TEXT[]),
    CONSTRAINT "support_access_grants_reason_check" CHECK (char_length(btrim("reason")) BETWEEN 10 AND 500),
    CONSTRAINT "support_access_grants_ticket_check" CHECK (char_length(btrim("ticket_reference")) BETWEEN 3 AND 60),
    CONSTRAINT "support_access_grants_window_check" CHECK ("ends_at" IS NULL OR ("starts_at" IS NOT NULL AND "ends_at" > "starts_at"))
);

CREATE UNIQUE INDEX "support_access_grants_organization_id_id_key" ON "support_access_grants"("organization_id", "id");
CREATE INDEX "support_access_grants_organization_id_requested_at_idx" ON "support_access_grants"("organization_id", "requested_at");
CREATE INDEX "support_access_grants_status_idx" ON "support_access_grants"("status");
-- One open request per organisation: a second ask has to wait for the first to be decided, ended or lapse.
CREATE UNIQUE INDEX "support_access_grants_one_open_per_organization" ON "support_access_grants"("organization_id") WHERE "status" IN ('PENDING', 'APPROVED', 'ACTIVE');

ALTER TABLE "support_access_grants"
  ADD CONSTRAINT "support_access_grants_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "support_access_page_views" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "organization_id" TEXT NOT NULL,
    "grant_id" TEXT NOT NULL,
    "viewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "identity_id" TEXT,
    "identity_label" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "page_offset" INTEGER NOT NULL DEFAULT 0,
    "row_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "support_access_page_views_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "support_access_page_views_grant_id_viewed_at_idx" ON "support_access_page_views"("grant_id", "viewed_at");
CREATE INDEX "support_access_page_views_organization_id_idx" ON "support_access_page_views"("organization_id");

ALTER TABLE "support_access_page_views"
  ADD CONSTRAINT "support_access_page_views_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "support_access_page_views"
  ADD CONSTRAINT "support_access_page_views_org_grant_fk"
  FOREIGN KEY ("organization_id", "grant_id") REFERENCES "support_access_grants" ("organization_id", "id") ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- The state machine, enforced by the database for whoever makes the change: the tenant role (figbloom_app) acts as the organisation; the
-- platform acts only inside the support_access_* functions below, which mark the transaction `app.support_actor = platform`; anything else
-- is the schema owner (migrations, the expiry job), which may let things lapse but can never approve for the organisation or open.
-- ---------------------------------------------------------------------------
CREATE FUNCTION support_access_grants_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tenant_side BOOLEAN := (current_user = 'figbloom_app');
  platform_side BOOLEAN := (NOT (current_user = 'figbloom_app')) AND coalesce(current_setting('app.support_actor', true), '') = 'platform';
  allowed BOOLEAN := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- The tenant and platform roles have no DELETE privilege either; the owner may remove rows only with their organisation (the foreign key cascade).
    IF platform_side OR tenant_side THEN
      RAISE EXCEPTION 'A support access record is never deleted.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF tenant_side THEN
      RAISE EXCEPTION 'Only the platform asks for support access.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'PENDING' OR NEW.decided_at IS NOT NULL OR NEW.decided_by_membership_id IS NOT NULL OR NEW.opened_at IS NOT NULL
       OR NEW.starts_at IS NOT NULL OR NEW.ends_at IS NOT NULL OR NEW.ended_at IS NOT NULL THEN
      RAISE EXCEPTION 'A support access request starts as PENDING, with no decision and no window.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: the request itself never changes.
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.requested_by_identity_id IS DISTINCT FROM OLD.requested_by_identity_id
     OR NEW.requested_by_label IS DISTINCT FROM OLD.requested_by_label OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.ticket_reference IS DISTINCT FROM OLD.ticket_reference OR NEW.scope IS DISTINCT FROM OLD.scope
     OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes OR NEW.unmask_contact_details IS DISTINCT FROM OLD.unmask_contact_details
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at OR NEW.request_expires_at IS DISTINCT FROM OLD.request_expires_at THEN
    RAISE EXCEPTION 'What was asked for cannot be changed; ask again.' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = OLD.status THEN
    -- No move: the decision, the window and the end are write-once.
    IF NEW.decided_at IS DISTINCT FROM OLD.decided_at OR NEW.decided_by_membership_id IS DISTINCT FROM OLD.decided_by_membership_id
       OR NEW.opened_at IS DISTINCT FROM OLD.opened_at OR NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
       OR NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
      RAISE EXCEPTION 'The decision and the window of a support access record cannot be rewritten.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Any role may let a request or a window lapse; the rest depends on who is acting.
  IF NEW.status = 'EXPIRED' AND OLD.status IN ('PENDING', 'APPROVED', 'ACTIVE') THEN
    allowed := true;
  ELSIF OLD.status = 'PENDING' AND NEW.status IN ('APPROVED', 'DENIED') THEN
    allowed := NOT platform_side;
  ELSIF OLD.status IN ('PENDING', 'APPROVED') AND NEW.status = 'CANCELLED' THEN
    allowed := NOT tenant_side;
  ELSIF OLD.status = 'APPROVED' AND NEW.status = 'ACTIVE' THEN
    allowed := NOT tenant_side;
  ELSIF OLD.status IN ('APPROVED', 'ACTIVE') AND NEW.status = 'ENDED' THEN
    allowed := true;
  END IF;
  IF NOT allowed THEN
    RAISE EXCEPTION 'A support access record cannot move from % to % for this caller.', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IN ('APPROVED', 'DENIED') AND (NEW.decided_at IS NULL OR NEW.decided_by_membership_id IS NULL) THEN
    RAISE EXCEPTION 'A decision names who decided and when.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'ACTIVE' THEN
    IF OLD.decided_at IS NULL OR OLD.decided_at < now() - interval '1 hour' THEN
      RAISE EXCEPTION 'The approval is older than one hour; ask again.' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.opened_by_identity_id IS DISTINCT FROM OLD.requested_by_identity_id OR NEW.opened_at IS NULL OR NEW.starts_at IS NULL OR NEW.ends_at IS NULL
       OR NEW.ends_at <> NEW.starts_at + (OLD.duration_minutes * interval '1 minute') THEN
      RAISE EXCEPTION 'The window must start when the session is opened and last exactly the approved time.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.status IN ('ENDED', 'EXPIRED', 'CANCELLED') AND NEW.ended_at IS NULL THEN
    NEW.ended_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER support_access_grants_guard BEFORE INSERT OR UPDATE OR DELETE ON "support_access_grants"
  FOR EACH ROW EXECUTE FUNCTION support_access_grants_guard();

CREATE FUNCTION support_access_page_views_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Rows go only with their organisation (the foreign key cascade, run as the owner); no other role can change or remove one.
  IF TG_OP = 'DELETE' AND current_user NOT IN ('figbloom_app', 'figbloom_platform') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'The support access page-view log is append-only.' USING ERRCODE = 'check_violation';
END
$$;
CREATE TRIGGER support_access_page_views_append_only BEFORE UPDATE OR DELETE ON "support_access_page_views"
  FOR EACH ROW EXECUTE FUNCTION support_access_page_views_append_only();

-- ---------------------------------------------------------------------------
-- Walls: row-level security on the organisation for the tenant role; no policy and no privilege for the platform role.
-- ---------------------------------------------------------------------------
ALTER TABLE "support_access_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_access_grants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "support_access_grants"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "support_access_page_views" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_access_page_views" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "support_access_page_views"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

-- ---------------------------------------------------------------------------
-- The read. Masking is structural: a value that is not selected cannot leak.
-- ---------------------------------------------------------------------------
CREATE FUNCTION support_iso(ts TIMESTAMP) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(ts, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

CREATE FUNCTION support_mask_email(v TEXT, mask BOOLEAN) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN v IS NULL THEN NULL
    WHEN NOT mask THEN v
    WHEN position('@' IN v) > 1 THEN left(v, 1) || '***' || substring(v FROM position('@' IN v))
    ELSE '***'
  END
$$;

CREATE FUNCTION support_mask_phone(v TEXT, mask BOOLEAN) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN v IS NULL THEN NULL WHEN NOT mask THEN v WHEN char_length(v) <= 2 THEN '***' ELSE '***' || right(v, 2) END
$$;

CREATE FUNCTION support_access_read(
  p_grant_id TEXT, p_identity_id TEXT, p_identity_label TEXT, p_resource TEXT, p_limit INTEGER, p_offset INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  g support_access_grants%ROWTYPE;
  org_status TEXT;
  lim INTEGER := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50);
  off INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
  mask BOOLEAN;
  total BIGINT;
  items JSONB;
BEGIN
  SELECT * INTO g FROM support_access_grants WHERE id = p_grant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPPORT_ACCESS:NO_GRANT' USING ERRCODE = 'P0001';
  END IF;
  -- R3: the clock is compared on every read; nothing needs a job to fire.
  IF g.status <> 'ACTIVE' OR g.opened_by_identity_id IS DISTINCT FROM p_identity_id OR g.starts_at IS NULL OR g.ends_at IS NULL
     OR now() < g.starts_at OR now() >= g.ends_at THEN
    RAISE EXCEPTION 'SUPPORT_ACCESS:NOT_ACTIVE' USING ERRCODE = 'P0001';
  END IF;
  SELECT o.status::text INTO org_status FROM organizations o WHERE o.id = g.organization_id;
  IF org_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'SUPPORT_ACCESS:ORGANISATION_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;
  IF NOT (p_resource = ANY (g.scope)) THEN
    RAISE EXCEPTION 'SUPPORT_ACCESS:OUT_OF_SCOPE' USING ERRCODE = 'P0001';
  END IF;

  -- R6: row-level security applies, to the one organisation the grant names.
  PERFORM set_config('app.current_organization_id', g.organization_id, true);
  mask := NOT g.unmask_contact_details;

  IF p_resource = 'COMPANIES' THEN
    SELECT count(*) INTO total FROM companies c WHERE c.organization_id = g.organization_id AND c.merged_into_id IS NULL;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', x.id, 'name', x.name, 'industry', x.industry, 'location', x.location,
        'email', support_mask_email(x.email, mask), 'phone', support_mask_phone(x.phone, mask),
        'archived', x.archived_at IS NOT NULL, 'createdAt', support_iso(x.created_at)) ORDER BY x.created_at DESC, x.id), '[]'::jsonb)
      INTO items
      FROM (SELECT * FROM companies c WHERE c.organization_id = g.organization_id AND c.merged_into_id IS NULL ORDER BY c.created_at DESC, c.id LIMIT lim OFFSET off) x;
  ELSIF p_resource = 'CONTACTS' THEN
    SELECT count(*) INTO total FROM contacts c WHERE c.organization_id = g.organization_id AND c.merged_into_id IS NULL;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', x.id, 'firstName', x.first_name, 'lastName', x.last_name, 'jobTitle', x.job_title, 'companyId', x.company_id,
        'email', support_mask_email(x.email, mask), 'phone', support_mask_phone(x.phone, mask),
        'doNotContact', x.do_not_contact, 'archived', x.archived_at IS NOT NULL, 'createdAt', support_iso(x.created_at)) ORDER BY x.created_at DESC, x.id), '[]'::jsonb)
      INTO items
      FROM (SELECT * FROM contacts c WHERE c.organization_id = g.organization_id AND c.merged_into_id IS NULL ORDER BY c.created_at DESC, c.id LIMIT lim OFFSET off) x;
  ELSIF p_resource = 'LEADS' THEN
    SELECT count(*) INTO total FROM leads l WHERE l.organization_id = g.organization_id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', x.id, 'status', x.status_name, 'temperature', x.temperature::text, 'companyId', x.company_id, 'contactId', x.contact_id,
        'nextFollowUpAt', support_iso(x.next_follow_up_at), 'converted', x.converted_at IS NOT NULL,
        'archived', x.archived_at IS NOT NULL, 'createdAt', support_iso(x.created_at)) ORDER BY x.created_at DESC, x.id), '[]'::jsonb)
      INTO items
      FROM (SELECT l.*, s.name AS status_name FROM leads l LEFT JOIN lead_statuses s ON s.id = l.lead_status_id
            WHERE l.organization_id = g.organization_id ORDER BY l.created_at DESC, l.id LIMIT lim OFFSET off) x;
  ELSIF p_resource = 'DEALS' THEN
    -- No value, currency, note or custom field: money is never part of a support view (R5).
    SELECT count(*) INTO total FROM deals d WHERE d.organization_id = g.organization_id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', x.id, 'stage', x.stage_name, 'outcome', x.outcome::text, 'companyId', x.company_id,
        'expectedCloseDate', x.expected_close_date::text, 'archived', x.archived_at IS NOT NULL,
        'createdAt', support_iso(x.created_at)) ORDER BY x.created_at DESC, x.id), '[]'::jsonb)
      INTO items
      FROM (SELECT d.*, s.name AS stage_name FROM deals d LEFT JOIN pipeline_stages s ON s.id = d.pipeline_stage_id
            WHERE d.organization_id = g.organization_id ORDER BY d.created_at DESC, d.id LIMIT lim OFFSET off) x;
  ELSIF p_resource = 'TASKS' THEN
    SELECT count(*) INTO total FROM tasks t WHERE t.organization_id = g.organization_id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', x.id, 'status', x.status::text, 'priority', x.priority::text, 'dueAt', support_iso(x.due_at),
        'archived', x.archived_at IS NOT NULL, 'createdAt', support_iso(x.created_at)) ORDER BY x.created_at DESC, x.id), '[]'::jsonb)
      INTO items
      FROM (SELECT * FROM tasks t WHERE t.organization_id = g.organization_id ORDER BY t.created_at DESC, t.id LIMIT lim OFFSET off) x;
  ELSE
    RAISE EXCEPTION 'SUPPORT_ACCESS:UNKNOWN_RESOURCE' USING ERRCODE = 'P0001';
  END IF;

  -- R7: the organisation can read this.
  INSERT INTO support_access_page_views (organization_id, grant_id, identity_id, identity_label, resource, page_offset, row_count)
  VALUES (g.organization_id, g.id, p_identity_id, p_identity_label, p_resource, off, jsonb_array_length(items));

  RETURN jsonb_build_object(
    'resource', p_resource, 'total', total, 'offset', off, 'limit', lim, 'items', items,
    'contactDetailsMasked', mask, 'endsAt', support_iso(g.ends_at));
END
$$;

-- ---------------------------------------------------------------------------
-- The platform's other doors: one function per allowed action. Each marks the transaction as the platform acting, so the trigger above
-- applies the platform's rules. They return the table's row type; the service maps it.
-- ---------------------------------------------------------------------------
CREATE FUNCTION support_access_request(
  p_organization_id TEXT, p_identity_id TEXT, p_identity_label TEXT, p_reason TEXT, p_ticket TEXT, p_scope TEXT[],
  p_minutes INTEGER, p_unmask BOOLEAN, p_now TIMESTAMP, p_valid_hours INTEGER
) RETURNS SETOF support_access_grants LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM set_config('app.support_actor', 'platform', true);
  RETURN QUERY
  INSERT INTO support_access_grants (id, organization_id, requested_by_identity_id, requested_by_label, reason, ticket_reference, scope,
                                     duration_minutes, unmask_contact_details, requested_at, request_expires_at)
  VALUES (gen_random_uuid()::text, p_organization_id, p_identity_id, p_identity_label, p_reason, p_ticket, p_scope,
          p_minutes, p_unmask, p_now, p_now + (p_valid_hours * interval '1 hour'))
  RETURNING *;
END
$$;

CREATE FUNCTION support_access_list(p_organization_id TEXT, p_limit INTEGER)
RETURNS SETOF support_access_grants LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM support_access_grants g WHERE (p_organization_id IS NULL OR g.organization_id = p_organization_id)
  ORDER BY g.requested_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 200)
$$;

CREATE FUNCTION support_access_get(p_id TEXT)
RETURNS SETOF support_access_grants LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM support_access_grants g WHERE g.id = p_id
$$;

CREATE FUNCTION support_access_page_views_for(p_grant_id TEXT, p_limit INTEGER)
RETURNS SETOF support_access_page_views LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM support_access_page_views v WHERE v.grant_id = p_grant_id
  ORDER BY v.viewed_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 200)
$$;

-- Opens an approved request for the admin who asked: the window starts at p_now and lasts what was approved.
CREATE FUNCTION support_access_open(p_id TEXT, p_identity_id TEXT, p_now TIMESTAMP)
RETURNS SETOF support_access_grants LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM set_config('app.support_actor', 'platform', true);
  RETURN QUERY
  UPDATE support_access_grants g
     SET status = 'ACTIVE', opened_at = p_now, opened_by_identity_id = p_identity_id, starts_at = p_now,
         ends_at = p_now + (g.duration_minutes * interval '1 minute')
   WHERE g.id = p_id AND g.status = 'APPROVED' AND g.requested_by_identity_id = p_identity_id
  RETURNING *;
END
$$;

-- Ends a running session (ENDED) or withdraws a request that is waiting or approved (CANCELLED). Returns no row when nothing could move.
CREATE FUNCTION support_access_end(p_id TEXT, p_from_status TEXT, p_label TEXT, p_now TIMESTAMP)
RETURNS SETOF support_access_grants LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM set_config('app.support_actor', 'platform', true);
  RETURN QUERY
  UPDATE support_access_grants g
     SET status = CASE WHEN p_from_status = 'ACTIVE' THEN 'ENDED' ELSE 'CANCELLED' END, ended_at = p_now, ended_by_label = p_label,
         end_reason = CASE WHEN p_from_status = 'ACTIVE' THEN 'ENDED_BY_PLATFORM' ELSE 'WITHDRAWN' END
   WHERE g.id = p_id AND g.status = p_from_status AND p_from_status IN ('PENDING', 'APPROVED', 'ACTIVE')
  RETURNING *;
END
$$;

DO $$
DECLARE
  fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'support_access_read(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER)',
    'support_access_request(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], INTEGER, BOOLEAN, TIMESTAMP, INTEGER)',
    'support_access_list(TEXT, INTEGER)',
    'support_access_get(TEXT)',
    'support_access_page_views_for(TEXT, INTEGER)',
    'support_access_open(TEXT, TEXT, TIMESTAMP)',
    'support_access_end(TEXT, TEXT, TEXT, TIMESTAMP)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'figbloom_platform') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO figbloom_platform', fn);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'figbloom_app') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM figbloom_app', fn);
    END IF;
  END LOOP;
END
$$;
