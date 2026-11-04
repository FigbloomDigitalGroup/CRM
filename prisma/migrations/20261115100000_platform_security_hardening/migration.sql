-- Security hardening for the platform console.
-- credentials_reset_at: last time a platform admin's password or second step was reset or recovered (or the identity created by invite).
-- A DELETE approval from an identity reset in the last 24 hours is refused.
ALTER TABLE "platform_identities" ADD COLUMN "credentials_reset_at" TIMESTAMP(3);

-- deletion_started_at: set (inside a transaction, under a row lock) before stored files are removed; once set the request can no
-- longer be cancelled and the deletion can be resumed after a crash.
ALTER TABLE "platform_data_requests" ADD COLUMN "deletion_started_at" TIMESTAMP(3);
