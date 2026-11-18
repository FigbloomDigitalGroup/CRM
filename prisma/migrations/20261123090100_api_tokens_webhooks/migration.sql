-- FIG-805 (public API tokens) and FIG-804 (outbound webhooks). Hand-written, same reasoning as the other composite tenant foreign keys.

CREATE TABLE "api_tokens" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "api_tokens_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 80),
    CONSTRAINT "api_tokens_scopes_check" CHECK (cardinality("scopes") BETWEEN 1 AND 20)
);

CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens"("token_hash");
CREATE INDEX "api_tokens_organization_id_membership_id_idx" ON "api_tokens"("organization_id", "membership_id");

ALTER TABLE "api_tokens"
  ADD CONSTRAINT "api_tokens_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A removed membership is soft-deleted (status REMOVED), so its tokens stop working through the membership check; a hard delete takes them too.
ALTER TABLE "api_tokens"
  ADD CONSTRAINT "api_tokens_org_membership_fk"
  FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE CASCADE;

CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secret_sealed" TEXT NOT NULL,
    "secret_hint" TEXT NOT NULL,
    "secret_rotated_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_delivery_at" TIMESTAMP(3),
    "created_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "webhook_endpoints_status_check" CHECK ("status" IN ('ACTIVE', 'PAUSED', 'DISABLED')),
    CONSTRAINT "webhook_endpoints_events_check" CHECK (cardinality("events") BETWEEN 1 AND 20),
    CONSTRAINT "webhook_endpoints_url_check" CHECK (char_length("url") BETWEEN 8 AND 2000)
);

CREATE UNIQUE INDEX "webhook_endpoints_organization_id_id_key" ON "webhook_endpoints"("organization_id", "id");
CREATE INDEX "webhook_endpoints_organization_id_status_idx" ON "webhook_endpoints"("organization_id", "status");

ALTER TABLE "webhook_endpoints"
  ADD CONSTRAINT "webhook_endpoints_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_endpoints"
  ADD CONSTRAINT "webhook_endpoints_org_created_by_fk"
  FOREIGN KEY ("organization_id", "created_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("created_by_membership_id");

CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "endpoint_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "last_attempt_at" TIMESTAMP(3),
    "last_status_code" INTEGER,
    "last_error" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "webhook_deliveries_status_check" CHECK ("status" IN ('PENDING', 'DELIVERED', 'DEAD'))
);

CREATE INDEX "webhook_deliveries_organization_id_status_next_attempt_at_idx" ON "webhook_deliveries"("organization_id", "status", "next_attempt_at");
CREATE INDEX "webhook_deliveries_endpoint_id_created_at_idx" ON "webhook_deliveries"("endpoint_id", "created_at");

ALTER TABLE "webhook_deliveries"
  ADD CONSTRAINT "webhook_deliveries_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_deliveries"
  ADD CONSTRAINT "webhook_deliveries_org_endpoint_fk"
  FOREIGN KEY ("organization_id", "endpoint_id") REFERENCES "webhook_endpoints" ("organization_id", "id")
  ON DELETE CASCADE;

ALTER TABLE "api_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "api_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "api_tokens"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_endpoints" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "webhook_endpoints"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "webhook_deliveries"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
