/**
 * The provider seam for OAuth connections (FIG-1153, B6.21). The framework talks to Google and Microsoft only through this
 * interface, so tests inject a fake and no real network call is ever made from a test. The real implementations are in
 * `./providers.ts`.
 */
export type OAuthProviderKey = "GOOGLE" | "MICROSOFT";
export type ConnectionKind = "EMAIL" | "CALENDAR";

export interface TokenSet {
  accessToken: string;
  /** Providers send a refresh token on the first grant; a refresh may or may not rotate it. */
  refreshToken?: string | null;
  /** Seconds until the access token expires. */
  expiresInSeconds: number;
  /** Scopes the provider actually granted (may be fewer than asked). */
  scopes?: string[];
  accountEmail?: string | null;
}

export interface AuthorizationRequest {
  state: string;
  codeChallenge: string;
  scopes: string[];
  redirectUri: string;
  loginHint?: string;
}

/** The provider refused the refresh token for good (revoked, expired, password changed): the person must connect again. */
export class OAuthInvalidGrantError extends Error {
  constructor(message = "The provider no longer accepts this connection.") {
    super(message);
    this.name = "OAuthInvalidGrantError";
  }
}

/** The provider could not be reached or answered with an error that may pass: try again later. */
export class OAuthTransientError extends Error {
  constructor(message = "The provider could not be reached.") {
    super(message);
    this.name = "OAuthTransientError";
  }
}

/**
 * The deployment has no client id and secret for this provider (`GOOGLE_OAUTH_*` / `MICROSOFT_OAUTH_*` unset). It is a kind of transient
 * error, so every place that already treats a provider problem as "try again later" keeps working; starting a connection turns it into a
 * clear 503 instead of a 500. The message names the provider only: no variable name, no value.
 */
export class OAuthNotConfiguredError extends OAuthTransientError {
  constructor(readonly provider: OAuthProviderKey) {
    super(`${provider === "GOOGLE" ? "Google" : "Microsoft"} sign-in is not configured for this deployment.`);
    this.name = "OAuthNotConfiguredError";
  }
}

export interface OAuthProviderClient {
  readonly key: OAuthProviderKey;
  buildAuthorizationUrl(request: AuthorizationRequest): string;
  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  /** Tells the provider to drop the grant. Best effort: the caller revokes locally whatever happens here. */
  revoke(token: string): Promise<void>;
}

/** Least-privilege scopes per provider and purpose (B6.21). Mail needs read + send; calendar needs events only. */
export const SCOPES: Record<OAuthProviderKey, Record<ConnectionKind, string[]>> = {
  GOOGLE: {
    EMAIL: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
    CALENDAR: ["openid", "email", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.calendarlist.readonly"],
  },
  MICROSOFT: {
    EMAIL: ["openid", "email", "offline_access", "User.Read", "Mail.Read", "Mail.Send"],
    CALENDAR: ["openid", "email", "offline_access", "User.Read", "Calendars.ReadWrite"],
  },
};
