-- R3-7: the quote guards enforce what the quotes document says, for a draft as well as for a locked version.
--  * A DRAFT (unlocked) version can only stay a draft, or be locked into PENDING_APPROVAL or SENT in the same statement.
--    It can never jump to APPROVED, REJECTED, ACCEPTED or DECLINED, and a non-draft status always carries `locked_at`.
--  * A line cannot be moved into (or out of) a locked version: both the old and the new `quote_version_id` are checked.

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
       OR NEW.currency IS DISTINCT FROM OLD.currency THEN
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

CREATE OR REPLACE FUNCTION quote_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  locked TIMESTAMP(3);
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT locked_at INTO locked FROM "quote_versions" WHERE id = OLD.quote_version_id;
    IF locked IS NOT NULL THEN
      RAISE EXCEPTION 'The lines of a locked quote version cannot change. Make a new version.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT locked_at INTO locked FROM "quote_versions" WHERE id = NEW.quote_version_id;
    IF locked IS NOT NULL THEN
      RAISE EXCEPTION 'The lines of a locked quote version cannot change. Make a new version.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;
