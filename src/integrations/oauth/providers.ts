import type { AuthorizationRequest, OAuthProviderClient, OAuthProviderKey, TokenSet } from "./types";
import { OAuthInvalidGrantError, OAuthNotConfiguredError, OAuthTransientError } from "./types";

/**
 * The real Google and Microsoft OAuth clients (FIG-1153, B6.21): authorization-code flow with PKCE, refresh, revoke.
 * They take a `fetch` so a test can stand a fake provider server in front of them. Client ids and secrets come from the
 * environment (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `MICROSOFT_OAUTH_CLIENT_ID`,
 * `MICROSOFT_OAUTH_CLIENT_SECRET`, optional `MICROSOFT_OAUTH_TENANT`, default `common`); none is ever in code.
 */
type Fetch = typeof fetch;

interface Endpoints {
  authorize: string;
  token: string;
  revoke: (token: string) => { url: string; init: RequestInit } | null;
  extraAuthParams: Record<string, string>;
}

const ENDPOINTS: Record<OAuthProviderKey, () => Endpoints> = {
  GOOGLE: () => ({
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    revoke: (token) => ({
      url: "https://oauth2.googleapis.com/revoke",
      init: { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) },
    }),
    // offline access gives a refresh token; consent makes Google send it again on a reconnect.
    extraAuthParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "false" },
  }),
  MICROSOFT: () => {
    const tenant = process.env.MICROSOFT_OAUTH_TENANT || "common";
    return {
      authorize: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
      token: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      // Microsoft has no token revocation endpoint for this flow; the local revoke drops the tokens.
      revoke: () => null,
      extraAuthParams: { response_mode: "query", prompt: "select_account" },
    };
  },
};

function credentials(provider: OAuthProviderKey): { clientId: string; clientSecret: string } {
  const prefix = provider === "GOOGLE" ? "GOOGLE" : "MICROSOFT";
  const clientId = process.env[`${prefix}_OAUTH_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_OAUTH_CLIENT_SECRET`];
  if (!clientId || !clientSecret) throw new OAuthNotConfiguredError(provider);
  return { clientId, clientSecret };
}

/** The email address inside an id_token, read without verification: the token came straight from the provider over TLS. */
function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== "string") return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    const email = payload.email ?? payload.preferred_username;
    return typeof email === "string" ? email.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function tokenRequest(provider: OAuthProviderKey, fetchImpl: Fetch, params: Record<string, string>): Promise<TokenSet> {
  const { clientId, clientSecret } = credentials(provider);
  let res: Response;
  try {
    res = await fetchImpl(ENDPOINTS[provider]().token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret }),
    });
  } catch {
    throw new OAuthTransientError();
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // Never include the response body in the message: it can echo the code or token.
    if (body.error === "invalid_grant") throw new OAuthInvalidGrantError();
    if (res.status >= 500 || res.status === 429) throw new OAuthTransientError();
    throw new OAuthInvalidGrantError(`The provider refused the request (${String(body.error ?? res.status)}).`);
  }
  if (typeof body.access_token !== "string") throw new OAuthTransientError("The provider answered without an access token.");
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresInSeconds: typeof body.expires_in === "number" ? body.expires_in : 3600,
    scopes: typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : undefined,
    accountEmail: emailFromIdToken(body.id_token),
  };
}

export function createOAuthProvider(provider: OAuthProviderKey, fetchImpl: Fetch = fetch): OAuthProviderClient {
  return {
    key: provider,
    buildAuthorizationUrl(request: AuthorizationRequest) {
      const { clientId } = credentials(provider);
      const url = new URL(ENDPOINTS[provider]().authorize);
      const params: Record<string, string> = {
        client_id: clientId,
        redirect_uri: request.redirectUri,
        response_type: "code",
        scope: request.scopes.join(" "),
        state: request.state,
        code_challenge: request.codeChallenge,
        code_challenge_method: "S256",
        ...ENDPOINTS[provider]().extraAuthParams,
      };
      if (request.loginHint) params.login_hint = request.loginHint;
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      return url.toString();
    },
    exchangeCode: ({ code, codeVerifier, redirectUri }) =>
      tokenRequest(provider, fetchImpl, { grant_type: "authorization_code", code, code_verifier: codeVerifier, redirect_uri: redirectUri }),
    refresh: (refreshToken) => tokenRequest(provider, fetchImpl, { grant_type: "refresh_token", refresh_token: refreshToken }),
    async revoke(token) {
      const call = ENDPOINTS[provider]().revoke(token);
      if (!call) return;
      try {
        await fetchImpl(call.url, call.init);
      } catch {
        /* best effort */
      }
    },
  };
}

let override: ((provider: OAuthProviderKey) => OAuthProviderClient) | null = null;

/** Tests (and a deployment that wants its own client) replace the provider factory; pass null to restore the real one. */
export function setOAuthProviderFactory(factory: ((provider: OAuthProviderKey) => OAuthProviderClient) | null): void {
  override = factory;
}

export function getOAuthProvider(provider: OAuthProviderKey): OAuthProviderClient {
  return override ? override(provider) : createOAuthProvider(provider);
}
