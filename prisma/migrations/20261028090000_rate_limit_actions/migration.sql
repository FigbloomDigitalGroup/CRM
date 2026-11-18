-- G1.05: the remaining public endpoints are rate limited like login and sign-up already are.
ALTER TYPE "AuthRateLimitAction" ADD VALUE IF NOT EXISTS 'INVITE_ACCEPT';
ALTER TYPE "AuthRateLimitAction" ADD VALUE IF NOT EXISTS 'PASSWORD_RESET_CONFIRM';
ALTER TYPE "AuthRateLimitAction" ADD VALUE IF NOT EXISTS 'INBOUND_EMAIL';
