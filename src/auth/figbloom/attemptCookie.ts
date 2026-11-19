/**
 * The sign-in attempt between /auth/figbloom/start and /auth/figbloom/callback: the state, the PKCE verifier and
 * where to go afterwards, in a short-lived httpOnly cookie that only those routes see. Not signed: the state in it must
 * match the one Cognito sends back, and the verifier is useless without the code, so tampering only breaks the
 * tamperer's own sign-in.
 */
import { safeNext } from "./settings";

export const ATTEMPT_COOKIE = "figbloom_signin";
export const ATTEMPT_MINUTES = 10;

export interface SignInAttempt {
  state: string;
  codeVerifier: string;
  next: string | null;
}

export function encodeAttempt(attempt: SignInAttempt): string {
  return Buffer.from(JSON.stringify(attempt)).toString("base64url");
}

export function decodeAttempt(value: string | undefined): SignInAttempt | null {
  if (!value) return null;
  try {
    const data = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof data.state !== "string" || typeof data.codeVerifier !== "string") return null;
    return { state: data.state, codeVerifier: data.codeVerifier, next: safeNext(typeof data.next === "string" ? data.next : null) };
  } catch {
    return null;
  }
}

export const attemptCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/auth/figbloom",
  maxAge: ATTEMPT_MINUTES * 60,
};
