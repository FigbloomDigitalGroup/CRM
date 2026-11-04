-- FIG-1151 (B6.19): the public web form endpoint is rate limited like the other public endpoints.
ALTER TYPE "AuthRateLimitAction" ADD VALUE IF NOT EXISTS 'WEB_FORM';
