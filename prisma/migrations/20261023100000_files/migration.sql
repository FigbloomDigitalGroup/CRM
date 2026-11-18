-- FIG-1023 (B1.07): `files`, the one safe place for avatars, organisation
-- logos, attachments, imports and exports. The bytes live in the storage
-- driver (local disk in development, S3-compatible in production) under a
-- per-organisation key prefix; this table is the authority on who owns a file,
-- what it is and whether it may be served.
--
-- Hand-written, same pattern as `deal_handoffs` and `idempotency_keys`:
-- Prisma's auto-diff would also propose dropping the hand-written composite
-- tenant foreign keys, so this file only adds what B1.07 needs.

CREATE TYPE "FilePurpose" AS ENUM ('AVATAR', 'LOGO', 'ATTACHMENT', 'IMPORT', 'EXPORT');
CREATE TYPE "FileStatus" AS ENUM ('UPLOADING', 'READY', 'QUARANTINED', 'DELETED');

CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "owner_membership_id" TEXT,
    "purpose" "FilePurpose" NOT NULL,
    "name" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "checksum_sha256" TEXT,
    "storage_key" TEXT NOT NULL,
    "status" "FileStatus" NOT NULL DEFAULT 'UPLOADING',
    "scan_result" TEXT,
    "quarantine_reason" TEXT,
    "upload_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "ready_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "purged_at" TIMESTAMP(3),

    CONSTRAINT "files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "files_size_bytes_check" CHECK ("size_bytes" >= 0),
    -- The key always starts with the organisation's own prefix, so a row can
    -- never point at another organisation's bytes.
    CONSTRAINT "files_storage_key_prefix_check"
      CHECK ("storage_key" LIKE 'orgs/' || "organization_id" || '/%')
);

CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");
-- Target of composite foreign keys from tables that reference a file.
CREATE UNIQUE INDEX "files_organization_id_id_key" ON "files"("organization_id", "id");
CREATE INDEX "files_organization_id_purpose_status_idx" ON "files"("organization_id", "purpose", "status");
CREATE INDEX "files_organization_id_owner_membership_id_idx" ON "files"("organization_id", "owner_membership_id");
CREATE INDEX "files_status_deleted_at_idx" ON "files"("status", "deleted_at");

ALTER TABLE "files"
  ADD CONSTRAINT "files_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- An owner can only be a membership of the file's own organization.
ALTER TABLE "files"
  ADD CONSTRAINT "files_org_owner_membership_fk"
  FOREIGN KEY ("organization_id", "owner_membership_id")
  REFERENCES "memberships" ("organization_id", "id")
  ON DELETE SET NULL ("owner_membership_id");

ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "files"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
