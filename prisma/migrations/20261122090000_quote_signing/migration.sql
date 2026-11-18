-- FIG-1186 (B7.04): e-signature on a sent quote. FIG-1189 (B7.07): a language per client document.
--
-- quote_signatures  one signature per quote version: who signed, what they saw (document hash), when, from where, and a seal hash over all of it.
--                   Append-only: a trigger refuses any update or delete (a cascade from the quote, deal or organisation still removes it).
-- quote_shares      + signing_enabled (this link may be used to sign), + language (the language of the document that was sent);
--                   the sent document and its hash can no longer be changed after the row exists.
-- web_forms         + language (the language of the public form's own text)
-- quote_events      + SIGNED, SIGN_REFUSED

ALTER TYPE "AuthRateLimitAction" ADD VALUE IF NOT EXISTS 'QUOTE_SIGN';

ALTER TABLE "quote_shares"
  ADD COLUMN "signing_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en',
  ADD CONSTRAINT "quote_shares_language_check" CHECK ("language" IN ('en', 'sw'));

ALTER TABLE "web_forms"
  ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en',
  ADD CONSTRAINT "web_forms_language_check" CHECK ("language" IN ('en', 'sw'));

ALTER TABLE "quote_events" DROP CONSTRAINT "quote_events_type_check";
ALTER TABLE "quote_events"
  ADD CONSTRAINT "quote_events_type_check" CHECK ("type" IN ('SENT', 'VIEWED', 'LINK_REVOKED', 'LINK_EXPIRED_VISIT', 'SIGNED', 'SIGN_REFUSED'));

CREATE TABLE "quote_signatures" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "quote_id" TEXT NOT NULL,
    "quote_version_id" TEXT NOT NULL,
    "share_id" TEXT,
    "signer_name" TEXT NOT NULL,
    "signer_email" TEXT,
    "signature_kind" TEXT NOT NULL,
    "signature_data" TEXT NOT NULL,
    "signature_sha256" TEXT NOT NULL,
    "consent_text" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "document_sha256" TEXT NOT NULL,
    "seal_sha256" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "signed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_signatures_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quote_signatures_kind_check" CHECK ("signature_kind" IN ('TYPED', 'DRAWN')),
    CONSTRAINT "quote_signatures_language_check" CHECK ("language" IN ('en', 'sw')),
    CONSTRAINT "quote_signatures_name_check" CHECK (char_length(btrim("signer_name")) BETWEEN 2 AND 200),
    CONSTRAINT "quote_signatures_data_size_check" CHECK (char_length("signature_data") BETWEEN 1 AND 120000),
    CONSTRAINT "quote_signatures_hash_check" CHECK ("seal_sha256" ~ '^[0-9a-f]{64}$' AND "document_sha256" ~ '^[0-9a-f]{64}$' AND "signature_sha256" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "quote_signatures_quote_version_id_key" ON "quote_signatures"("quote_version_id");
CREATE UNIQUE INDEX "quote_signatures_organization_id_id_key" ON "quote_signatures"("organization_id", "id");
CREATE INDEX "quote_signatures_organization_id_quote_id_idx" ON "quote_signatures"("organization_id", "quote_id");

ALTER TABLE "quote_signatures"
  ADD CONSTRAINT "quote_signatures_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quote_signatures"
  ADD CONSTRAINT "quote_signatures_org_quote_fk" FOREIGN KEY ("organization_id", "quote_id") REFERENCES "quotes" ("organization_id", "id") ON DELETE CASCADE;
ALTER TABLE "quote_signatures"
  ADD CONSTRAINT "quote_signatures_org_version_fk" FOREIGN KEY ("organization_id", "quote_version_id") REFERENCES "quote_versions" ("organization_id", "id") ON DELETE CASCADE;

-- Append-only. `pg_trigger_depth() > 1` is a foreign-key cascade (the quote, deal or organisation is being deleted), the only way a signature goes.
-- A signature can be recorded only for a version that is SENT, so nothing is signed that the client was never given.
CREATE FUNCTION quote_signatures_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO v_status FROM quote_versions WHERE id = NEW.quote_version_id AND organization_id = NEW.organization_id;
    IF v_status IS DISTINCT FROM 'SENT' THEN
      RAISE EXCEPTION 'a quote version can be signed only while it is SENT (it is %)', COALESCE(v_status, 'missing');
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'a signed quote record cannot be changed or deleted';
END;
$$;

CREATE TRIGGER quote_signatures_guard BEFORE INSERT OR UPDATE OR DELETE ON "quote_signatures"
  FOR EACH ROW EXECUTE FUNCTION quote_signatures_guard();

-- The sent document, its hash, its link and its language are fixed once the share exists (only counters and the revoke time move).
CREATE FUNCTION quote_shares_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.document_html IS DISTINCT FROM OLD.document_html
     OR NEW.document_sha256 IS DISTINCT FROM OLD.document_sha256
     OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.quote_version_id IS DISTINCT FROM OLD.quote_version_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.signing_enabled IS DISTINCT FROM OLD.signing_enabled
     OR NEW.language IS DISTINCT FROM OLD.language THEN
    RAISE EXCEPTION 'the document, link and language of a sent quote cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER quote_shares_guard BEFORE UPDATE ON "quote_shares"
  FOR EACH ROW EXECUTE FUNCTION quote_shares_guard();

ALTER TABLE "quote_signatures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quote_signatures" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "quote_signatures"
  USING (organization_id = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true));
