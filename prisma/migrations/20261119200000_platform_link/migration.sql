-- Figbloom platform and console (ERP/CRM_PLATFORM_CONTRACT.md).

-- A suspended organisation: paused by Figbloom from the console, everything kept.
ALTER TYPE "OrganizationStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';

-- What still has to be sent to the platform (one row per entity).
CREATE TABLE "platform_sync_queue" (
    "id" TEXT NOT NULL,
    "entity_kind" TEXT NOT NULL,
    "local_id" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_sync_queue_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "platform_sync_queue_entity_kind_local_id_key" ON "platform_sync_queue"("entity_kind", "local_id");
CREATE INDEX "platform_sync_queue_next_attempt_at_idx" ON "platform_sync_queue"("next_attempt_at");

-- The platform's IDs for what CRM registered.
CREATE TABLE "platform_links" (
    "entity_kind" TEXT NOT NULL,
    "local_id" TEXT NOT NULL,
    "platform_id" TEXT NOT NULL,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_links_pkey" PRIMARY KEY ("entity_kind", "local_id")
);

-- Decision deliveries already applied.
CREATE TABLE "platform_deliveries" (
    "delivery_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_deliveries_pkey" PRIMARY KEY ("delivery_id")
);

-- Only the schema-owner connection uses these: row-level security on with no policy, so the app role (which
-- `db-admin grant-role` also revokes from them) can never read or write them.
ALTER TABLE "platform_sync_queue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform_deliveries" ENABLE ROW LEVEL SECURITY;
