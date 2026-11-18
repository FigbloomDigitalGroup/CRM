-- FIG-1144 (B6.12): share links and view tracking for sent quotes.
--
-- quote_shares  one row per link: only the hash of the token, an expiry, the exact document that was sent, and view counters
-- quote_events  what happened to a sent quote (sent, viewed, revoked, an expired link opened)
-- The public link has its own rate-limit action.

ALTER TYPE "AuthRateLimitAction" ADD VALUE IF NOT EXISTS 'QUOTE_VIEW';

CREATE TABLE "quote_shares" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "quote_version_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "document_html" TEXT NOT NULL,
    "document_sha256" TEXT NOT NULL,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "first_viewed_at" TIMESTAMP(3),
    "last_viewed_at" TIMESTAMP(3),
    "last_timeline_at" TIMESTAMP(3),
    "created_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_shares_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quote_shares_view_count_check" CHECK ("view_count" >= 0)
);

CREATE UNIQUE INDEX "quote_shares_token_hash_key" ON "quote_shares"("token_hash");
CREATE UNIQUE INDEX "quote_shares_organization_id_id_key" ON "quote_shares"("organization_id", "id");
CREATE INDEX "quote_shares_organization_id_quote_version_id_idx" ON "quote_shares"("organization_id", "quote_version_id");

CREATE TABLE "quote_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "quote_version_id" TEXT NOT NULL,
    "share_id" TEXT,
    "type" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_agent" TEXT,

    CONSTRAINT "quote_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quote_events_type_check" CHECK ("type" IN ('SENT', 'VIEWED', 'LINK_REVOKED', 'LINK_EXPIRED_VISIT'))
);

CREATE INDEX "quote_events_organization_id_quote_version_id_occurred_at_idx" ON "quote_events"("organization_id", "quote_version_id", "occurred_at");

ALTER TABLE "quote_shares"
  ADD CONSTRAINT "quote_shares_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_shares"
  ADD CONSTRAINT "quote_shares_org_version_fk" FOREIGN KEY ("organization_id", "quote_version_id") REFERENCES "quote_versions" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "quote_shares"
  ADD CONSTRAINT "quote_shares_org_created_by_fk" FOREIGN KEY ("organization_id", "created_by_membership_id") REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("created_by_membership_id");

ALTER TABLE "quote_events"
  ADD CONSTRAINT "quote_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_events"
  ADD CONSTRAINT "quote_events_org_quote_fk" FOREIGN KEY ("organization_id", "quote_id") REFERENCES "quotes" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "quote_events"
  ADD CONSTRAINT "quote_events_org_version_fk" FOREIGN KEY ("organization_id", "quote_version_id") REFERENCES "quote_versions" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "quote_events"
  ADD CONSTRAINT "quote_events_org_share_fk" FOREIGN KEY ("organization_id", "share_id") REFERENCES "quote_shares" ("organization_id", "id") ON DELETE SET NULL ("share_id");

ALTER TABLE "quote_shares" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quote_shares" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "quote_shares"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "quote_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quote_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "quote_events"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
