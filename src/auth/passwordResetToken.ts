import { randomBytes, createHash } from "node:crypto";
import { adminDb } from "../db/adminClient";

/**
 * Single-use, short-lived tokens backing both "forgot password" and "set
 * your first password" (FIG-592) -- same generate-random/hash-and-compare
 * pattern as sessions and the website API key. Deliberately short-lived
 * (1 hour): unlike a session, this token grants the ability to take over the
 * account outright, so it should not sit valid in an inbox for long.
 */
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export async function createPasswordResetToken(
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const plaintext = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(plaintext);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await adminDb.passwordResetToken.create({
    data: { userId, tokenHash, expiresAt },
  });

  return { token: plaintext, expiresAt };
}

/**
 * Resolves a reset token to its user id and marks it used in the same step
 * -- there is no separate "peek without consuming" path, so a token can
 * never be replayed even if the request that consumes it fails afterward
 * partway through (the caller must complete the password change in the same
 * transaction-adjacent call).
 */
export async function consumePasswordResetToken(
  token: string,
): Promise<string | null> {
  const tokenHash = hashToken(token);
  const record = await adminDb.passwordResetToken.findUnique({
    where: { tokenHash },
  });

  if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  await adminDb.passwordResetToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });

  return record.userId;
}
