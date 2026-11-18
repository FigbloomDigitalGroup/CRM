-- FIG-1134 (B6.02): two-step sign-in (authenticator code, backup codes, trusted devices).
--
-- Two sets of tables, one per identity type, because the two identity types
-- must never share a table (the platform database role may touch only
-- platform tables):
--   tenant users:     user_two_step, user_backup_codes, user_trusted_devices, two_step_challenges
--   platform admins:  platform_two_step, platform_backup_codes, platform_two_step_challenges
-- Platform admins have no trusted devices on purpose (docs/TWO_STEP_SIGN_IN.md).
--
-- None of these tables has an organisation_id: like `sessions` they belong to
-- a person, not to an organisation, and are read only through the
-- schema-owner connection (the tenant application role is revoked below).
-- Secrets: `secret_encrypted` is AES-256-GCM ciphertext, `code_hash` a keyed
-- hash, `token_hash` a SHA-256 of a random token. No plaintext secret is stored.

-- 1. Rate-limit buckets for the new steps.
ALTER TYPE "AuthRateLimitAction" ADD VALUE IF NOT EXISTS 'TWO_STEP_VERIFY';
ALTER TYPE "AuthRateLimitAction" ADD VALUE IF NOT EXISTS 'TWO_STEP_ENROL';
ALTER TYPE "AuthRateLimitAction" ADD VALUE IF NOT EXISTS 'PLATFORM_LOGIN';

-- 2. Tenant users.
CREATE TABLE "user_two_step" (
    "user_id" TEXT NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "enabled_at" TIMESTAMP(3),
    "last_used_step" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_two_step_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "user_two_step_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "user_backup_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_backup_codes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_backup_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_backup_codes_user_id_code_hash_key" ON "user_backup_codes"("user_id", "code_hash");

CREATE TABLE "user_trusted_devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "label" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    CONSTRAINT "user_trusted_devices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_trusted_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_trusted_devices_token_hash_key" ON "user_trusted_devices"("token_hash");
CREATE INDEX "user_trusted_devices_user_id_idx" ON "user_trusted_devices"("user_id");

-- A password-verified sign-in waiting for its second step. `purpose` is VERIFY
-- (enter a code) or ENROL (policy requires two-step and the person has none yet).
CREATE TABLE "two_step_challenges" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMP(3),
    "user_agent" TEXT,
    "ip_address" TEXT,
    "place" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "two_step_challenges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "two_step_challenges_purpose_check" CHECK ("purpose" IN ('VERIFY', 'ENROL')),
    CONSTRAINT "two_step_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "two_step_challenges_token_hash_key" ON "two_step_challenges"("token_hash");
CREATE INDEX "two_step_challenges_user_id_idx" ON "two_step_challenges"("user_id");

-- 3. Platform admins: same shapes, own tables, own role.
CREATE TABLE "platform_two_step" (
    "platform_identity_id" TEXT NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "enabled_at" TIMESTAMP(3),
    "last_used_step" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_two_step_pkey" PRIMARY KEY ("platform_identity_id"),
    CONSTRAINT "platform_two_step_identity_fkey" FOREIGN KEY ("platform_identity_id") REFERENCES "platform_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "platform_backup_codes" (
    "id" TEXT NOT NULL,
    "platform_identity_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_backup_codes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_backup_codes_identity_fkey" FOREIGN KEY ("platform_identity_id") REFERENCES "platform_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "platform_backup_codes_identity_code_hash_key" ON "platform_backup_codes"("platform_identity_id", "code_hash");

CREATE TABLE "platform_two_step_challenges" (
    "id" TEXT NOT NULL,
    "platform_identity_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMP(3),
    "user_agent" TEXT,
    "ip_address" TEXT,
    "place" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_two_step_challenges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_two_step_challenges_purpose_check" CHECK ("purpose" IN ('VERIFY', 'ENROL')),
    CONSTRAINT "platform_two_step_challenges_identity_fkey" FOREIGN KEY ("platform_identity_id") REFERENCES "platform_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "platform_two_step_challenges_token_hash_key" ON "platform_two_step_challenges"("token_hash");
CREATE INDEX "platform_two_step_challenges_identity_idx" ON "platform_two_step_challenges"("platform_identity_id");

-- 4. Walls. Platform tables: RLS forced, a policy for the platform role only.
--    Tenant-user tables: privileges revoked from the application role (it
--    never reads secrets; the sign-in code runs as the schema owner).
ALTER TABLE "platform_two_step" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_two_step" FORCE ROW LEVEL SECURITY;
ALTER TABLE "platform_backup_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_backup_codes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "platform_two_step_challenges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_two_step_challenges" FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_access ON "platform_two_step" FOR ALL TO figbloom_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_access ON "platform_backup_codes" FOR ALL TO figbloom_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_access ON "platform_two_step_challenges" FOR ALL TO figbloom_platform USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'figbloom_app') THEN
    EXECUTE 'REVOKE ALL ON "user_two_step", "user_backup_codes", "user_trusted_devices", "two_step_challenges" FROM figbloom_app';
    EXECUTE 'REVOKE ALL ON "platform_two_step", "platform_backup_codes", "platform_two_step_challenges" FROM figbloom_app';
  END IF;
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "platform_two_step", "platform_backup_codes", "platform_two_step_challenges" TO figbloom_platform';
END
$$;
