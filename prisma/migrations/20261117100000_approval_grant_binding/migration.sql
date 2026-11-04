-- A deal-move approval is a grant for THIS value and currency (review finding 3): the request records what the deal was worth when
-- it was asked for, and the grant is only usable while the deal still has that value and currency. Rows made before this
-- migration have no snapshot (grant_currency is null) and are never usable, so they have to be asked for again.
ALTER TABLE "approval_requests" ADD COLUMN "grant_value" DECIMAL(14,2);
ALTER TABLE "approval_requests" ADD COLUMN "grant_currency" TEXT;
