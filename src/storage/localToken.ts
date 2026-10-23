import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The signed links the local-disk driver hands out. The link is a bearer
 * capability bound to one key, one method and an expiry: the HMAC covers all
 * three, so a link for organisation A's file cannot be edited into a link for
 * anything else, and it stops working when it expires.
 */
export interface LocalTokenPayload {
  /** Method the link allows. */
  m: "GET" | "PUT";
  /** Storage key. */
  k: string;
  /** Expiry, epoch seconds. */
  e: number;
  /** Content type a PUT must declare. */
  ct?: string;
  /** Most bytes a PUT may carry. */
  mb?: number;
  /** Download name. */
  fn?: string;
  /** Disposition for a GET. */
  d?: "inline" | "attachment";
}

const b64url = (buf: Buffer) => buf.toString("base64url");

export function signLocalToken(payload: LocalTokenPayload, secret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export type LocalTokenResult =
  | { ok: true; payload: LocalTokenPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyLocalToken(token: string, secret: string, now: Date = new Date()): LocalTokenResult {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return { ok: false, reason: "malformed" };
  const expected = createHmac("sha256", secret).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad_signature" };
  }
  let payload: LocalTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload.k !== "string" || typeof payload.e !== "number" || (payload.m !== "GET" && payload.m !== "PUT")) {
    return { ok: false, reason: "malformed" };
  }
  if (payload.e * 1000 <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}
