-- FIG-1382 (B6.24): chat data model. Channels (public, private, direct, record-linked), members, messages, mentions,
-- attachments, reactions, read markers, and presence. Every table carries the organisation id, has row-level security
-- forced with the same tenant_isolation policy as every tenant table, and references its parents through composite
-- (organization_id, id) foreign keys, so no row can point into another organisation.
--
-- Hand-written (the composite foreign keys are not expressible in schema.prisma), like the other tenant tables.
-- Kinds and statuses are TEXT with CHECK constraints so a later value is a one-line migration.

CREATE TABLE "chat_channels" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "record_type" TEXT,
    "record_id" TEXT,
    "direct_key" TEXT,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "archived_by_membership_id" TEXT,
    "created_by_membership_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_channels_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_channels_kind_chk" CHECK ("kind" IN ('PUBLIC', 'PRIVATE', 'DIRECT', 'RECORD')),
    CONSTRAINT "chat_channels_name_chk" CHECK ("name" IS NULL OR char_length(btrim("name")) BETWEEN 1 AND 80),
    CONSTRAINT "chat_channels_shape_chk" CHECK (
      ("kind" = 'DIRECT' AND "direct_key" IS NOT NULL AND "name" IS NULL AND "record_id" IS NULL)
      OR ("kind" = 'RECORD' AND "record_type" IN ('DEAL', 'COMPANY', 'LEAD') AND "record_id" IS NOT NULL AND "name" IS NOT NULL AND "direct_key" IS NULL)
      OR ("kind" IN ('PUBLIC', 'PRIVATE') AND "name" IS NOT NULL AND "record_id" IS NULL AND "direct_key" IS NULL)
    ),
    CONSTRAINT "chat_channels_archive_chk" CHECK (("archived_at" IS NULL) OR "kind" <> 'DIRECT'),
    CONSTRAINT "chat_channels_seq_chk" CHECK ("last_seq" >= 0)
);

CREATE UNIQUE INDEX "chat_channels_organization_id_id_key" ON "chat_channels"("organization_id", "id");
CREATE UNIQUE INDEX "chat_channels_org_direct_key_key" ON "chat_channels"("organization_id", "direct_key") WHERE "direct_key" IS NOT NULL;
CREATE UNIQUE INDEX "chat_channels_org_name_key" ON "chat_channels"("organization_id", lower("name")) WHERE "kind" IN ('PUBLIC', 'PRIVATE') AND "archived_at" IS NULL;
CREATE UNIQUE INDEX "chat_channels_org_record_key" ON "chat_channels"("organization_id", "record_type", "record_id") WHERE "kind" = 'RECORD' AND "archived_at" IS NULL;
CREATE INDEX "chat_channels_org_kind_idx" ON "chat_channels"("organization_id", "kind", "archived_at");

CREATE TABLE "chat_channel_members" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "added_by_membership_id" TEXT,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_channel_members_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_channel_members_role_chk" CHECK ("role" IN ('OWNER', 'MEMBER'))
);

CREATE UNIQUE INDEX "chat_channel_members_channel_membership_key" ON "chat_channel_members"("channel_id", "membership_id");
CREATE INDEX "chat_channel_members_org_membership_idx" ON "chat_channel_members"("organization_id", "membership_id");

CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "author_membership_id" TEXT,
    "body" TEXT NOT NULL,
    "card_type" TEXT,
    "card_id" TEXT,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_membership_id" TEXT,
    "erased_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_messages_body_chk" CHECK (char_length("body") <= 4000),
    CONSTRAINT "chat_messages_card_chk" CHECK (("card_type" IS NULL) = ("card_id" IS NULL)),
    CONSTRAINT "chat_messages_card_type_chk" CHECK ("card_type" IS NULL OR "card_type" IN ('DEAL', 'COMPANY', 'LEAD', 'INVOICE'))
);

CREATE UNIQUE INDEX "chat_messages_organization_id_id_key" ON "chat_messages"("organization_id", "id");
CREATE UNIQUE INDEX "chat_messages_channel_seq_key" ON "chat_messages"("channel_id", "seq");
CREATE INDEX "chat_messages_org_author_idx" ON "chat_messages"("organization_id", "author_membership_id");
CREATE INDEX "chat_messages_org_updated_idx" ON "chat_messages"("organization_id", "updated_at");
CREATE INDEX "chat_messages_org_created_idx" ON "chat_messages"("organization_id", "created_at");
CREATE INDEX "chat_messages_body_trgm_idx" ON "chat_messages" USING gin ("body" gin_trgm_ops);

CREATE TABLE "chat_message_mentions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,

    CONSTRAINT "chat_message_mentions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_message_mentions_message_membership_key" ON "chat_message_mentions"("message_id", "membership_id");
CREATE INDEX "chat_message_mentions_org_membership_idx" ON "chat_message_mentions"("organization_id", "membership_id");

CREATE TABLE "chat_message_attachments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_message_attachments_message_file_key" ON "chat_message_attachments"("message_id", "file_id");
CREATE INDEX "chat_message_attachments_org_file_idx" ON "chat_message_attachments"("organization_id", "file_id");

CREATE TABLE "chat_reactions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_reactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_reactions_emoji_chk" CHECK (char_length("emoji") BETWEEN 1 AND 16)
);

CREATE UNIQUE INDEX "chat_reactions_message_member_emoji_key" ON "chat_reactions"("message_id", "membership_id", "emoji");
CREATE INDEX "chat_reactions_org_membership_idx" ON "chat_reactions"("organization_id", "membership_id");

CREATE TABLE "chat_read_markers" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "last_read_seq" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_read_markers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_read_markers_seq_chk" CHECK ("last_read_seq" >= 0)
);

CREATE UNIQUE INDEX "chat_read_markers_channel_membership_key" ON "chat_read_markers"("channel_id", "membership_id");
CREATE INDEX "chat_read_markers_org_membership_idx" ON "chat_read_markers"("organization_id", "membership_id");

CREATE TABLE "chat_presence" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ONLINE',
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "typing_channel_id" TEXT,
    "typing_until" TIMESTAMP(3),

    CONSTRAINT "chat_presence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_presence_status_chk" CHECK ("status" IN ('ONLINE', 'AWAY'))
);

CREATE UNIQUE INDEX "chat_presence_org_membership_key" ON "chat_presence"("organization_id", "membership_id");

-- Tenant integrity: every reference stays inside the organisation.
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_org_created_by_fk" FOREIGN KEY ("organization_id", "created_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("created_by_membership_id");
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_org_archived_by_fk" FOREIGN KEY ("organization_id", "archived_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("archived_by_membership_id");

ALTER TABLE "chat_channel_members" ADD CONSTRAINT "chat_channel_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_channel_members" ADD CONSTRAINT "chat_channel_members_org_channel_fk" FOREIGN KEY ("organization_id", "channel_id") REFERENCES "chat_channels" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "chat_channel_members" ADD CONSTRAINT "chat_channel_members_org_membership_fk" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "chat_channel_members" ADD CONSTRAINT "chat_channel_members_org_added_by_fk" FOREIGN KEY ("organization_id", "added_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("added_by_membership_id");

ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_org_channel_fk" FOREIGN KEY ("organization_id", "channel_id") REFERENCES "chat_channels" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_org_author_fk" FOREIGN KEY ("organization_id", "author_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("author_membership_id");
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_org_deleted_by_fk" FOREIGN KEY ("organization_id", "deleted_by_membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE SET NULL ("deleted_by_membership_id");

ALTER TABLE "chat_message_mentions" ADD CONSTRAINT "chat_message_mentions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_message_mentions" ADD CONSTRAINT "chat_message_mentions_org_message_fk" FOREIGN KEY ("organization_id", "message_id") REFERENCES "chat_messages" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "chat_message_mentions" ADD CONSTRAINT "chat_message_mentions_org_membership_fk" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;

ALTER TABLE "chat_message_attachments" ADD CONSTRAINT "chat_message_attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_message_attachments" ADD CONSTRAINT "chat_message_attachments_org_message_fk" FOREIGN KEY ("organization_id", "message_id") REFERENCES "chat_messages" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "chat_message_attachments" ADD CONSTRAINT "chat_message_attachments_org_file_fk" FOREIGN KEY ("organization_id", "file_id") REFERENCES "files" ("organization_id", "id") ON DELETE CASCADE;

ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_org_message_fk" FOREIGN KEY ("organization_id", "message_id") REFERENCES "chat_messages" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_org_membership_fk" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;

ALTER TABLE "chat_read_markers" ADD CONSTRAINT "chat_read_markers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_read_markers" ADD CONSTRAINT "chat_read_markers_org_channel_fk" FOREIGN KEY ("organization_id", "channel_id") REFERENCES "chat_channels" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "chat_read_markers" ADD CONSTRAINT "chat_read_markers_org_membership_fk" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;

ALTER TABLE "chat_presence" ADD CONSTRAINT "chat_presence_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_presence" ADD CONSTRAINT "chat_presence_org_membership_fk" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "chat_presence" ADD CONSTRAINT "chat_presence_org_typing_channel_fk" FOREIGN KEY ("organization_id", "typing_channel_id") REFERENCES "chat_channels" ("organization_id", "id") ON DELETE SET NULL ("typing_channel_id");

-- Row-level security, same policy as every tenant table.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['chat_channels', 'chat_channel_members', 'chat_messages', 'chat_message_mentions', 'chat_message_attachments', 'chat_reactions', 'chat_read_markers', 'chat_presence']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id = current_setting(''app.current_organization_id'', true)) WITH CHECK (organization_id = current_setting(''app.current_organization_id'', true))', t);
  END LOOP;
END
$$;
