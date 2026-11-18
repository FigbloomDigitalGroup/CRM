-- FIG-805: the public API rate limit counts per token (and per address) in the shared rate-limit table.
ALTER TYPE "AuthRateLimitAction" ADD VALUE IF NOT EXISTS 'API_TOKEN';
