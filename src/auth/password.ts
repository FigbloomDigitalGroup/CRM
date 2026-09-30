import bcrypt from "bcryptjs";

/**
 * Slow, salted hashing for human-chosen passwords -- deliberately different
 * from the fast SHA-256 used for machine-generated tokens elsewhere
 * (src/auth/websiteApiKey.ts, src/auth/session.ts), where the input already
 * has enough entropy that a slow hash would only cost performance for no
 * security benefit.
 */
const SALT_ROUNDS = 12;
export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

export async function verifyPassword(
  plaintext: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

export function isPasswordStrongEnough(plaintext: string): boolean {
  return plaintext.length >= MIN_PASSWORD_LENGTH;
}
