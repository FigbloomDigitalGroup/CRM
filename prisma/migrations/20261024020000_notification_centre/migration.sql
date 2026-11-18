-- FIG-1040 (B2.11): notification centre. Archive a notification, and an index
-- that serves the feed and the unread count (newest first, per member).
ALTER TABLE "notifications" ADD COLUMN "archived_at" TIMESTAMP(3);
CREATE INDEX "notifications_feed_idx"
  ON "notifications" ("organization_id", "membership_id", "archived_at", "created_at" DESC);
