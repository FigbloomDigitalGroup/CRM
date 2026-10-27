import { enforceRateLimit } from "./rateLimiter";

/**
 * Rate limits for the public endpoints that take a secret token rather than a password (G1.05): accepting an invite, confirming a
 * password reset, and the inbound-email webhook. The tokens are long and random, so guessing one is not realistic; the limit keeps
 * a flood of bad attempts from costing the database a lookup each, and the numbers are high enough that no real person or mail
 * provider reaches them. A request with no usable address is not limited by address (it cannot be), but is still limited per target.
 */
const WINDOW_MS = 15 * 60 * 1000;

export function limitInviteAccept(ipAddress: string | null) {
  return enforceRateLimit("INVITE_ACCEPT", [{ scope: "ip", key: ipAddress, windowMs: WINDOW_MS, max: 30 }]);
}

export function limitPasswordResetConfirm(ipAddress: string | null) {
  return enforceRateLimit("PASSWORD_RESET_CONFIRM", [{ scope: "ip", key: ipAddress, windowMs: WINDOW_MS, max: 30 }]);
}

/** A mail provider sends from a handful of addresses and may send a lot, so this is generous per address and per organisation. */
export function limitInboundEmail(ipAddress: string | null, orgSlug: string) {
  return enforceRateLimit("INBOUND_EMAIL", [
    { scope: "ip", key: ipAddress, windowMs: WINDOW_MS, max: 1200 },
    { scope: "org", key: orgSlug.slice(0, 100), windowMs: WINDOW_MS, max: 3000 },
  ]);
}
