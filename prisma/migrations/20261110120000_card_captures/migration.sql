-- FIG-1154 (B6.22): business-card capture.
--
-- One row per card photo taken: the uploaded image (a normal file, scanned and checked by the file service), what the reader
-- suggested, and what became of it. The suggestion is never a record: a lead exists only after the person has seen every field
-- and confirmed (status CONFIRMED, with the lead or contact it became).

CREATE TABLE "card_captures" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADING',
    "extractor" TEXT,
    "extracted" JSONB,
    "unsure" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "extraction_note" TEXT,
    "lead_id" TEXT,
    "contact_id" TEXT,
    "outcome" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_captures_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "card_captures_status_chk" CHECK ("status" IN ('UPLOADING', 'EXTRACTED', 'CONFIRMED', 'DISCARDED'))
);
CREATE UNIQUE INDEX "card_captures_file_key" ON "card_captures"("file_id");
CREATE INDEX "card_captures_org_member_idx" ON "card_captures"("organization_id", "membership_id", "status");
ALTER TABLE "card_captures" ADD CONSTRAINT "card_captures_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "card_captures" ADD CONSTRAINT "card_captures_org_member_fk"
  FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "card_captures" ADD CONSTRAINT "card_captures_org_file_fk"
  FOREIGN KEY ("organization_id", "file_id") REFERENCES "files" ("organization_id", "id") ON DELETE CASCADE;

ALTER TABLE "card_captures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "card_captures" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "card_captures"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
