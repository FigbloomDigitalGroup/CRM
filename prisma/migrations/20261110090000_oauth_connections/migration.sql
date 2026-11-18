-- FIG-1153 (B6.21): OAuth connection framework for email and calendar.
--
-- One row per connection a person (or, if Management decides so, the organisation as a shared
-- mailbox) makes to a Google or Microsoft account. Tokens are stored ONLY as AES-256-GCM
-- ciphertext (src/lib/secretBox.ts); no column ever holds a plaintext token. `oauth_states` holds
-- the one-time `state` of an authorisation in progress (hashed) with its PKCE verifier (encrypted).
-- Hand-written like the other tables with composite tenant foreign keys.

CREATE TABLE "oauth_connections" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    -- NULL = the shared organisation mailbox / calendar.
    "membership_id" TEXT,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "account_email" TEXT,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "access_token_enc" TEXT,
    "refresh_token_enc" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "last_refreshed_at" TIMESTAMP(3),
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "last_error" TEXT,
    "last_error_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "sync_cursor" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "oauth_connections_kind_chk" CHECK ("kind" IN ('EMAIL', 'CALENDAR')),
    CONSTRAINT "oauth_connections_provider_chk" CHECK ("provider" IN ('GOOGLE', 'MICROSOFT')),
    CONSTRAINT "oauth_connections_status_chk" CHECK ("status" IN ('CONNECTED', 'NEEDS_RECONNECT', 'REVOKED'))
);

CREATE UNIQUE INDEX "oauth_connections_org_id_key" ON "oauth_connections"("organization_id", "id");
-- At most one live connection per person and kind (and one shared per organisation and kind).
CREATE UNIQUE INDEX "oauth_connections_live_member_key" ON "oauth_connections"("organization_id", "membership_id", "kind")
  WHERE "revoked_at" IS NULL AND "membership_id" IS NOT NULL;
CREATE UNIQUE INDEX "oauth_connections_live_shared_key" ON "oauth_connections"("organization_id", "kind")
  WHERE "revoked_at" IS NULL AND "membership_id" IS NULL;
CREATE INDEX "oauth_connections_org_status_idx" ON "oauth_connections"("organization_id", "status");

ALTER TABLE "oauth_connections" ADD CONSTRAINT "oauth_connections_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_connections" ADD CONSTRAINT "oauth_connections_org_member_fk"
  FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;

CREATE TABLE "oauth_states" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "state_hash" TEXT NOT NULL,
    "code_verifier_enc" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oauth_states_state_hash_key" ON "oauth_states"("state_hash");
CREATE INDEX "oauth_states_org_idx" ON "oauth_states"("organization_id", "expires_at");

ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_org_member_fk"
  FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;

ALTER TABLE "oauth_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauth_connections" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "oauth_connections"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "oauth_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "oauth_states" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "oauth_states"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
