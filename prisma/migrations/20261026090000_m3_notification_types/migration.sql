-- Stage 3 (M3): two more notification types.
--   PAYMENT_OVERDUE  : an invoice passed its due date (FIG-1050, B3.04), for Finance and the deal owner.
--   DORMANT_CUSTOMER : a customer went dormant (FIG-795), for the account owner.
-- Added on their own so the next migration can use them in an index.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PAYMENT_OVERDUE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DORMANT_CUSTOMER';
