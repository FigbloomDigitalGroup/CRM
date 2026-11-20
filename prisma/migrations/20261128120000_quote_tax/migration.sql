-- UC-R5 (FIG-1798): tax on quotes. Additive only: three nullable columns on quote_versions and the lock trigger now freezes them.
--  * tax_mode   'INCLUSIVE' (the default, and what every existing quote is) or 'EXCLUSIVE'.
--  * tax_rate_bp the rate in basis points (1600 = 16%). NULL means no tax lines: every existing quote stays NULL and is worked out exactly as before.
--  * tax_label  the name shown on the document ("VAT"), copied from the organisation setting so a later change never alters a sent quote.
-- Existing rows are not touched: the new columns read NULL (tax_mode reads its default), no data is rewritten.

ALTER TABLE "quote_versions" ADD COLUMN IF NOT EXISTS "tax_mode" TEXT DEFAULT 'INCLUSIVE';
ALTER TABLE "quote_versions" ADD COLUMN IF NOT EXISTS "tax_rate_bp" INTEGER;
ALTER TABLE "quote_versions" ADD COLUMN IF NOT EXISTS "tax_label" TEXT;

ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_tax_mode_check" CHECK ("tax_mode" IS NULL OR "tax_mode" IN ('INCLUSIVE', 'EXCLUSIVE'));
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_tax_rate_check" CHECK ("tax_rate_bp" IS NULL OR ("tax_rate_bp" >= 0 AND "tax_rate_bp" <= 10000));
ALTER TABLE "quote_versions" ADD CONSTRAINT "quote_versions_tax_label_check" CHECK ("tax_label" IS NULL OR char_length("tax_label") BETWEEN 1 AND 20);

-- The same guard as before (20261119120000_quote_guards_strict), with the three tax columns added to what a locked version cannot change.
CREATE OR REPLACE FUNCTION quote_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.locked_at IS NOT NULL AND pg_trigger_depth() = 1 THEN
      RAISE EXCEPTION 'Quote version % is locked and cannot be deleted.', OLD.version USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.locked_at IS NOT NULL THEN
    IF NEW.locked_at IS DISTINCT FROM OLD.locked_at
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.quote_id IS DISTINCT FROM OLD.quote_id
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.discount_percent IS DISTINCT FROM OLD.discount_percent
       OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
       OR NEW.terms IS DISTINCT FROM OLD.terms
       OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
       OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
       OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.cost_total IS DISTINCT FROM OLD.cost_total
       OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.tax_mode IS DISTINCT FROM OLD.tax_mode
       OR NEW.tax_rate_bp IS DISTINCT FROM OLD.tax_rate_bp
       OR NEW.tax_label IS DISTINCT FROM OLD.tax_label THEN
      RAISE EXCEPTION 'Quote version % is locked: its content cannot change. Make a new version.', OLD.version USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
         (OLD.status = 'PENDING_APPROVAL' AND NEW.status IN ('APPROVED', 'REJECTED'))
      OR (OLD.status = 'APPROVED' AND NEW.status = 'SENT')
      OR (OLD.status = 'SENT' AND NEW.status IN ('ACCEPTED', 'DECLINED'))
    ) THEN
      RAISE EXCEPTION 'Quote version % cannot go from % to %.', OLD.version, OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    -- A draft: it stays a draft, or is locked into PENDING_APPROVAL or SENT in the same statement.
    IF NEW.status = 'DRAFT' THEN
      IF NEW.locked_at IS NOT NULL THEN
        RAISE EXCEPTION 'Quote version % is a draft and cannot be locked without leaving draft.', OLD.version USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.status IN ('PENDING_APPROVAL', 'SENT') THEN
      IF NEW.locked_at IS NULL THEN
        RAISE EXCEPTION 'Quote version % must be locked when it leaves draft.', OLD.version USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      RAISE EXCEPTION 'Quote version % cannot go from % to %.', OLD.version, OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
