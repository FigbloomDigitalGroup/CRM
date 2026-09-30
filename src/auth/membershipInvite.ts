import { randomBytes, createHash } from "node:crypto";

/**
 * Membership invite tokens (FIG-593) -- same generate-random/hash-and-
 * compare pattern as sessions, password resets, and the website API key.
 * Longer-lived than a password-reset token (7 days, not 1 hour): an invite
 * is often accepted well after it's sent, and unlike a password reset it
 * doesn't grant control over an existing account, just the ability to
 * accept a specific, already-decided membership.
 */
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashInviteToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function generateInviteToken(): {
  plaintext: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const plaintext = randomBytes(32).toString("base64url");
  return {
    plaintext,
    tokenHash: hashInviteToken(plaintext),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  };
}
