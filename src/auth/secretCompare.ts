import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compares a presented secret with the expected one in constant time (G1.05). Both sides are hashed first so the comparison runs on
 * equal-length buffers whatever was sent, which also hides the expected secret's length. A missing value never matches.
 */
export function secretsMatch(provided: string | null | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
