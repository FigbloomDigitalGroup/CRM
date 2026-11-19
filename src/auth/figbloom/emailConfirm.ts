import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * "Confirm your email" after signing up with Figbloom sign-in (ERP/CRM_COGNITO_CONTRACT.md section 2). Signing up
 * proves nothing about the address, and Figbloom's "Forgot password" only sends codes to a verified one, so the
 * welcome email carries this link; opening it has the platform mark the email verified.
 *
 * The token is signed, not stored: `{ typ, uid, sub, exp }`, valid 14 days, signed with a key derived from CRM's
 * client secret for this purpose only (rotating that secret ends outstanding links, which is fine: the person can
 * still sign in, and only "Forgot password" waits for the confirmation).
 */

const TYPE = "crm_confirm_email";
export const CONFIRM_EMAIL_DAYS = 14;

function key(clientSecret: string): Buffer {
  return createHmac("sha256", clientSecret).update("crm:confirm-email").digest();
}

const sign = (payload: string, clientSecret: string) => createHmac("sha256", key(clientSecret)).update(payload).digest("base64url");

export function confirmEmailToken(user: { id: string; identitySub: string }, clientSecret: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ typ: TYPE, uid: user.id, sub: user.identitySub, exp: now + CONFIRM_EMAIL_DAYS * 86_400_000 }),
  ).toString("base64url");
  return `${payload}.${sign(payload, clientSecret)}`;
}

/** -> { uid, sub }, or null when forged, expired or another kind of token. */
export function readConfirmEmailToken(token: string, clientSecret: string, now = Date.now()): { uid: string; sub: string } | null {
  const [payload, signature, extra] = String(token).split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, clientSecret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (data.typ !== TYPE || typeof data.uid !== "string" || typeof data.sub !== "string" || typeof data.exp !== "number") return null;
    if (data.exp < now) return null;
    return { uid: data.uid, sub: data.sub };
  } catch {
    return null;
  }
}
