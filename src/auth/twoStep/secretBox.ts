import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Safe storage for two-step secrets (FIG-1134, B6.02).
 *
 *   - An authenticator (TOTP) seed must be readable by the server to check a
 *     code, so it is stored ENCRYPTED (AES-256-GCM, random 96-bit nonce per
 *     value, version-prefixed so the key can be rotated). The key comes from
 *     `TWO_STEP_ENCRYPTION_KEY` (base64, 32 bytes) and lives in the secret
 *     manager, never in the database.
 *   - A backup code is only ever compared, never read back, so it is stored as
 *     a keyed hash (HMAC-SHA-256 with a key derived from the same secret).
 *
 * Fail closed: in production there is no fallback key. Outside production a
 * fixed development key keeps local runs and tests working; it protects
 * nothing and must never be used for real data.
 */
const DEV_ONLY_KEY_SEED = "figbloom-dev-only-two-step-key-protects-nothing";
const VERSION = "v1";

function masterKey(env: Record<string, string | undefined> = process.env): Buffer {
  const raw = env.TWO_STEP_ENCRYPTION_KEY;
  if (raw) {
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) throw new Error("TWO_STEP_ENCRYPTION_KEY must be 32 bytes, base64 encoded.");
    return key;
  }
  if (env.NODE_ENV === "production") {
    throw new Error("TWO_STEP_ENCRYPTION_KEY is not set (required in production for two-step sign-in).");
  }
  return createHash("sha256").update(DEV_ONLY_KEY_SEED).digest();
}

/** Encrypts a secret for storage. The output is opaque text: `v1.<nonce>.<tag>.<ciphertext>`. */
export function sealSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** Decrypts what `sealSecret` produced. Throws on any tampering or a wrong key. */
export function openSecret(sealed: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !body) throw new Error("Unrecognised sealed secret.");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

/** Keyed hash for values that are only ever compared (backup codes). Domain-separated from encryption. */
export function keyedHash(purpose: string, value: string): string {
  const key = createHmac("sha256", masterKey()).update(`figbloom:${purpose}`).digest();
  return createHmac("sha256", key).update(value).digest("hex");
}

/** Plain SHA-256 of a high-entropy random token (challenge and device tokens), like session tokens. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}
