-- FIG-807 (two-way Gmail / Outlook sync) and FIG-808 (calendar sync and meeting links), on the OAuth framework (FIG-1153).
--
--   mail_drafts           drafts, the outbox (a send claims its row once, so a double send cannot send twice) and scheduled sends
--   calendar_event_links  the pairing between a provider event and the CRM activity or task, so updates and cancellations
--                         sync both ways without duplicates

CREATE TABLE "mail_drafts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "to_addresses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "cc_addresses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "reply_to_communication_id" TEXT,
    "company_id" TEXT,
    "contact_id" TEXT,
    "lead_id" TEXT,
    "deal_id" TEXT,
    "attachment_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scheduled_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "communication_id" TEXT,
    "connection_id" TEXT,
    "external_message_id" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mail_drafts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mail_drafts_status_chk" CHECK ("status" IN ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED'))
);
CREATE INDEX "mail_drafts_org_member_idx" ON "mail_drafts"("organization_id", "membership_id", "status");
CREATE INDEX "mail_drafts_org_external_idx" ON "mail_drafts"("organization_id", "external_message_id");
ALTER TABLE "mail_drafts" ADD CONSTRAINT "mail_drafts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mail_drafts" ADD CONSTRAINT "mail_drafts_org_member_fk"
  FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;

CREATE TABLE "calendar_event_links" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "membership_id" TEXT,
    "calendar_id" TEXT NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "external_etag" TEXT,
    "source" TEXT NOT NULL,
    "activity_id" TEXT,
    "task_id" TEXT,
    "communication_id" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "join_url" TEXT,
    "attendees" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_event_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "calendar_event_links_source_chk" CHECK ("source" IN ('CRM', 'PROVIDER', 'TASK')),
    CONSTRAINT "calendar_event_links_status_chk" CHECK ("status" IN ('CONFIRMED', 'CANCELLED'))
);
-- A provider event is paired once; an activity or task has one event per connection.
CREATE UNIQUE INDEX "calendar_event_links_event_key" ON "calendar_event_links"("connection_id", "external_event_id");
CREATE UNIQUE INDEX "calendar_event_links_activity_key" ON "calendar_event_links"("connection_id", "activity_id") WHERE "activity_id" IS NOT NULL;
CREATE UNIQUE INDEX "calendar_event_links_task_key" ON "calendar_event_links"("connection_id", "task_id") WHERE "task_id" IS NOT NULL;
CREATE INDEX "calendar_event_links_org_activity_idx" ON "calendar_event_links"("organization_id", "activity_id");
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendar_event_links" ADD CONSTRAINT "calendar_event_links_org_connection_fk"
  FOREIGN KEY ("organization_id", "connection_id") REFERENCES "oauth_connections" ("organization_id", "id") ON DELETE CASCADE;

ALTER TABLE "mail_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mail_drafts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "mail_drafts"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));

ALTER TABLE "calendar_event_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calendar_event_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "calendar_event_links"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
