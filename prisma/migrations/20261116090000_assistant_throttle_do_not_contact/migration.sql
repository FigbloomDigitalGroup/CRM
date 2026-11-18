-- Per-minute throttle for the assistant ask route, and a do-not-contact flag honoured by sequences.
ALTER TYPE "AuthRateLimitAction" ADD VALUE IF NOT EXISTS 'ASSISTANT_ASK';
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "do_not_contact" BOOLEAN NOT NULL DEFAULT false;
