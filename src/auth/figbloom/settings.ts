/**
 * Figbloom sign-in (ERP/CRM_COGNITO_CONTRACT.md): on Figbloom's AWS production, people sign in on Figbloom's own
 * sign-in page (Cognito, customers pool) instead of CRM's /login. `COGNITO_SIGN_IN=on` switches it on; anything else
 * (the default) leaves CRM's own sign-in exactly as it is, frozen pages included.
 *
 * Every value is read at request time: one Docker image runs everywhere, with different settings.
 *
 *   COGNITO_SIGN_IN            "on" switches Figbloom sign-in on
 *   COGNITO_REGION             e.g. eu-west-1
 *   COGNITO_CUSTOMERS_POOL_ID  e.g. eu-west-1_r7qAgJf1F
 *   COGNITO_CUSTOMERS_DOMAIN   the sign-in page's address, e.g. https://figbloom.auth.eu-west-1.amazoncognito.com
 *   CRM_WEB_CLIENT_ID, CRM_WEB_CLIENT_SECRET   CRM's app client (crm-web-<env>)
 *   APP_BASE_URL               CRM's own address (already a CRM setting), e.g. https://crm.figbloom.org
 *   PLATFORM_API_URL, PLATFORM_TOKEN_URL, PLATFORM_CLIENT_ID, PLATFORM_CLIENT_SECRET   the Platform API and CRM's
 *                              service client (crm-service-<env>), to create people's Figbloom accounts
 */

export const START_PATH = "/auth/figbloom/start";
export const CALLBACK_PATH = "/auth/figbloom/callback";
export const SIGNED_OUT_PATH = "/auth/figbloom/signed-out";
export const ERROR_PATH = "/auth/figbloom/error";
export const CONFIRM_EMAIL_PATH = "/auth/figbloom/confirm-email";

type Env = Record<string, string | undefined>;

export function figbloomSignInEnabled(env: Env = process.env): boolean {
  return (env.COGNITO_SIGN_IN ?? "").trim().toLowerCase() === "on";
}

export interface FigbloomSettings {
  clientId: string;
  clientSecret: string;
  /** the sign-in page's address, without a trailing slash */
  domain: string;
  /** the ID token's issuer */
  issuer: string;
  poolId: string;
  /** CRM's own address, without a trailing slash */
  appBaseUrl: string;
}

const REQUIRED = [
  "COGNITO_REGION",
  "COGNITO_CUSTOMERS_POOL_ID",
  "COGNITO_CUSTOMERS_DOMAIN",
  "CRM_WEB_CLIENT_ID",
  "CRM_WEB_CLIENT_SECRET",
  "APP_BASE_URL",
] as const;

/** The sign-in settings; throws naming every missing one (never a value), so a half-configured server says so. */
export function figbloomSettings(env: Env = process.env): FigbloomSettings {
  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length) {
    throw new Error(`Figbloom sign-in is on but these settings are missing: ${missing.join(", ")}`);
  }
  const value = (name: (typeof REQUIRED)[number]) => (env[name] as string).trim();
  const region = value("COGNITO_REGION");
  const poolId = value("COGNITO_CUSTOMERS_POOL_ID");
  return {
    clientId: value("CRM_WEB_CLIENT_ID"),
    clientSecret: value("CRM_WEB_CLIENT_SECRET"),
    domain: value("COGNITO_CUSTOMERS_DOMAIN").replace(/\/+$/, ""),
    issuer: `https://cognito-idp.${region}.amazonaws.com/${poolId}`,
    poolId,
    appBaseUrl: value("APP_BASE_URL").replace(/\/+$/, ""),
  };
}

export const callbackUrl = (s: FigbloomSettings) => `${s.appBaseUrl}${CALLBACK_PATH}`;

/** Where to send someone to sign in: the pool's authorize endpoint, code + PKCE (S256). */
export function authorizeUrl(s: FigbloomSettings, state: string, codeChallenge: string): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: s.clientId,
    redirect_uri: callbackUrl(s),
    scope: "openid email profile",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${s.domain}/oauth2/authorize?${query}`;
}

/** The sign-in page's own "Forgot password" (CRM's /forgot-password and /reset-password send people here). */
export function forgotPasswordUrl(s: FigbloomSettings): string {
  const query = new URLSearchParams({
    client_id: s.clientId,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: callbackUrl(s),
  });
  return `${s.domain}/forgotPassword?${query}`;
}

/** Ends the sign-in page's own session too, then comes back to CRM's "You're signed out". */
export function signOutUrl(s: FigbloomSettings): string {
  const query = new URLSearchParams({ client_id: s.clientId, logout_uri: `${s.appBaseUrl}${SIGNED_OUT_PATH}` });
  return `${s.domain}/logout?${query}`;
}

/**
 * A place inside CRM to go after signing in, or null. Only a path on this site: one slash, no scheme or host, no
 * backslashes (some browsers read them as slashes), not the sign-in pages themselves.
 */
export function safeNext(value: string | null | undefined): string | null {
  if (!value || value.length > 512) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  if ([...value].some((ch) => ch.charCodeAt(0) < 0x20)) return null;
  if (value.startsWith("/auth/figbloom") || value.startsWith("/login")) return null;
  return value;
}
