-- FIG-1140 (B6.08): platform admins, minimum-two rule, platform security settings and recovery.
--
-- Platform-only tables: the platform database role gets exactly these (no tenant
-- table), RLS is forced with a policy for the platform role only, and the tenant
-- application role is revoked. No platform admin is created here, and none is
-- created by a production seed: the first one comes from an invite issued by
-- `npm run platform:bootstrap-admin` (docs/PLATFORM_ADMINS.md).

-- 1. Sign-in lockout on the identity (same idea as users.locked_until).
ALTER TABLE "platform_identities" ADD COLUMN "failed_sign_in_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "platform_identities" ADD COLUMN "last_failed_sign_in_at" TIMESTAMP(3);
ALTER TABLE "platform_identities" ADD COLUMN "locked_until" TIMESTAMP(3);

-- 2. "Verify it's you": when this session last proved the admin again with a code.
ALTER TABLE "platform_sessions" ADD COLUMN "verified_at" TIMESTAMP(3);
UPDATE "platform_sessions" SET "verified_at" = "created_at" WHERE "verified_at" IS NULL;

-- 3. Invitations and recovery links. kind INVITE: a new admin (email, name).
--    kind RECOVERY: an existing admin gets a new password and must enrol again.
--    Only the SHA-256 of the token is stored.
CREATE TABLE "platform_admin_invites" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "platform_identity_id" TEXT,
    "token_hash" TEXT NOT NULL,
    "invited_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    CONSTRAINT "platform_admin_invites_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "platform_admin_invites_kind_check" CHECK ("kind" IN ('INVITE', 'RECOVERY')),
    CONSTRAINT "platform_admin_invites_identity_fkey" FOREIGN KEY ("platform_identity_id") REFERENCES "platform_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "platform_admin_invites_token_hash_key" ON "platform_admin_invites"("token_hash");
CREATE INDEX "platform_admin_invites_email_idx" ON "platform_admin_invites"("email");

-- 4. Platform security settings: one row per setting, validated in code.
CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" TEXT,
    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- 5. Walls and privileges.
ALTER TABLE "platform_admin_invites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_admin_invites" FORCE ROW LEVEL SECURITY;
ALTER TABLE "platform_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_access ON "platform_admin_invites" FOR ALL TO figbloom_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_access ON "platform_settings" FOR ALL TO figbloom_platform USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'figbloom_app') THEN
    EXECUTE 'REVOKE ALL ON "platform_admin_invites", "platform_settings" FROM figbloom_app';
  END IF;
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "platform_admin_invites", "platform_settings" TO figbloom_platform';
END
$$;
