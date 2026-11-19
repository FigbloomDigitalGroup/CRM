import { createHash, randomBytes } from "node:crypto";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { callbackUrl, type FigbloomSettings } from "./settings";

/**
 * The sign-in round trip with Figbloom's sign-in page (ERP/CRM_COGNITO_CONTRACT.md section 2): CRM makes a PKCE
 * verifier and a state, the browser signs in there, and CRM exchanges the code it comes back with -- with its client
 * secret, server to server -- for an ID token it then verifies. The browser never holds a Cognito token.
 */

const TIMEOUT_MS = 10_000;

/** A refusal at any step; `code` decides the message on the error page. Never carries a token or a secret. */
export class FigbloomSignInError extends Error {
  constructor(
    readonly code:
      | "sign_in_expired"
      | "sign_in_failed"
      | "sign_in_unreachable"
      | "state_mismatch"
      | "account_inactive"
      | "account_deactivated"
      | "no_email",
    message: string,
  ) {
    super(message);
    this.name = "FigbloomSignInError";
  }
}

const base64url = (bytes: Buffer) => bytes.toString("base64url");

/** A fresh state and PKCE pair (RFC 7636, S256). */
export function newSignInAttempt(): { state: string; codeVerifier: string; codeChallenge: string } {
  const codeVerifier = base64url(randomBytes(48));
  return {
    state: base64url(randomBytes(24)),
    codeVerifier,
    codeChallenge: base64url(createHash("sha256").update(codeVerifier).digest()),
  };
}

/** What CRM uses from a verified ID token. */
export interface FigbloomIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

type FetchLike = typeof fetch;

async function send(url: string, init: RequestInit, fetchImpl: FetchLike): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal, redirect: "error" });
  } catch {
    throw new FigbloomSignInError("sign_in_unreachable", "Figbloom sign-in could not be reached. Please try again.");
  } finally {
    clearTimeout(timer);
  }
}

/** code + its verifier -> the ID token (exchanged with the client secret). */
export async function exchangeCode(
  s: FigbloomSettings,
  code: string,
  codeVerifier: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const basic = Buffer.from(`${s.clientId}:${s.clientSecret}`).toString("base64");
  const res = await send(
    `${s.domain}/oauth2/token`,
    {
      method: "POST",
      headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: s.clientId,
        code,
        code_verifier: codeVerifier,
        redirect_uri: callbackUrl(s),
      }).toString(),
    },
    fetchImpl,
  );
  const data = (await res.json().catch(() => null)) as { id_token?: unknown; error?: unknown } | null;
  if (!res.ok || typeof data?.id_token !== "string") {
    // invalid_grant: the code was used, has expired, or isn't for this client and address
    throw data?.error === "invalid_grant"
      ? new FigbloomSignInError("sign_in_expired", "That sign-in has expired. Please sign in again.")
      : new FigbloomSignInError("sign_in_failed", "Figbloom sign-in did not complete. Please try again.");
  }
  return data.id_token;
}

const verifiers = new Map<string, ReturnType<typeof CognitoJwtVerifier.create>>();

/** Verifies the ID token: signed by the pool, issued for CRM's client, an ID token, not expired. */
export async function verifyIdToken(s: FigbloomSettings, idToken: string): Promise<FigbloomIdentity> {
  const key = `${s.poolId}|${s.clientId}`;
  let verifier = verifiers.get(key);
  if (!verifier) {
    verifier = CognitoJwtVerifier.create({ userPoolId: s.poolId, clientId: s.clientId, tokenUse: "id" });
    verifiers.set(key, verifier);
  }
  let claims: Record<string, unknown>;
  try {
    claims = (await verifier.verify(idToken)) as unknown as Record<string, unknown>;
  } catch {
    throw new FigbloomSignInError("sign_in_failed", "This sign-in couldn't be checked. Please sign in again.");
  }
  return identityFromClaims(claims);
}

/** The parts of verified claims CRM uses (exported for tests). */
export function identityFromClaims(claims: Record<string, unknown>): FigbloomIdentity {
  if (typeof claims.sub !== "string" || !claims.sub) {
    throw new FigbloomSignInError("sign_in_failed", "This sign-in couldn't be checked. Please sign in again.");
  }
  return {
    sub: claims.sub,
    email: typeof claims.email === "string" ? claims.email.trim().toLowerCase() : null,
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
    name: typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : null,
  };
}
