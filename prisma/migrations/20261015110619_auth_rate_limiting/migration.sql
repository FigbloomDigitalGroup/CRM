-- FIG-784: auth_rate_limit_attempts table -- a single, durable,
-- cross-instance counter shared by login/signup/password-reset-request and
-- the website lead-capture endpoint (replacing that endpoint's own
-- WebsiteLeadRequestLog-based count, which keeps serving its original
-- per-org monitoring purpose unchanged). See the model's own doc comment
-- in schema.prisma for the full reasoning.
--
-- Like scheduled_job_runs (FIG-783), this table has no organization_id at
-- all, so it gets neither row-level security nor a composite
-- tenant-integrity foreign key -- same treatment as that migration's own
-- header comment describes.

-- ---------------------------------------------------------------------------
-- 1. Enum
-- ---------------------------------------------------------------------------

CREATE TYPE "AuthRateLimitAction" AS ENUM ('LOGIN', 'SIGNUP', 'PASSWORD_RESET', 'WEBSITE_LEAD');

-- ---------------------------------------------------------------------------
-- 2. Table
-- ---------------------------------------------------------------------------

CREATE TABLE "auth_rate_limit_attempts" (
    "id" TEXT NOT NULL,
    "action" "AuthRateLimitAction" NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_rate_limit_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auth_rate_limit_attempts_action_scope_key_created_at_idx" ON "auth_rate_limit_attempts"("action", "scope", "key", "created_at");

-- ---------------------------------------------------------------------------
-- 3. Access: the RLS-scoped app role has no business with this table at
--    all (writes and the count-based reads both happen via the
--    schema-owner adminDb connection -- this check runs before any org/
--    session context exists). Revoked outright rather than merely unused,
--    same defensive reasoning as website_lead_request_log's write-side
--    revoke, but stricter here since there isn't even a read-side use.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'figbloom_app') THEN
    EXECUTE 'REVOKE SELECT, INSERT, UPDATE, DELETE ON "auth_rate_limit_attempts" FROM figbloom_app';
  ELSE
    RAISE NOTICE 'Role "figbloom_app" does not exist yet -- run "npm run db:bootstrap-role" then "npm run db:grant-role" to finish granting privileges.';
  END IF;
END
$$;
