import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encryption at rest for integration secrets: OAuth access and refresh tokens, PKCE verifiers (FIG-1153, B6.21).
 *
 * AES-256-GCM with a fresh random 96-bit nonce per value. The key comes from `INTEGRATION_ENCRYPTION_KEY` (base64 of
 * 32 random bytes; a secret manager value in every real environment, never a committed one). With no key the box fails
 * closed: nothing is stored in the clear as a fallback. A value is `v1.<nonce>.<tag>.<ciphertext>` (base64url), so a
 * later key rotation can add `v2` without breaking what is stored.
 */
const VERSION = "v1";

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

function key(): Buffer {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) throw new SecretBoxError("INTEGRATION_ENCRYPTION_KEY is not set, so integration secrets cannot be stored or read.");
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== 32) throw new SecretBoxError("INTEGRATION_ENCRYPTION_KEY must be base64 of exactly 32 bytes.");
  return bytes;
}

export function isSecretBoxConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

export function sealSecret(plain: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function openSecret(sealed: string): string {
  const [version, nonce, tag, body] = sealed.split(".");
  if (version !== VERSION || !nonce || !tag || !body) throw new SecretBoxError("The stored secret is not in a known format.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(nonce, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch (err) {
    if (err instanceof SecretBoxError) throw err;
    throw new SecretBoxError("The stored secret could not be decrypted (wrong key or altered value).");
  }
}

/** SHA-256 hex of a one-time value (an OAuth `state`), so only the hash is stored. */
export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
