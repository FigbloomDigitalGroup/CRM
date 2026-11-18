-- Support requests by email (docs/SUPPORT_BY_EMAIL.md, decision 12): a member may send only a few per hour.
-- The counter lives in the shared rate-limit table; this adds its action.
ALTER TYPE "AuthRateLimitAction" ADD VALUE IF NOT EXISTS 'SUPPORT_REQUEST';
