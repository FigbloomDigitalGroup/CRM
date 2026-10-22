/**
 * CSRF defence for the cookie-authenticated API (FIG-802).
 *
 * The session cookie is `sameSite: lax`, which blocks most cross-site POSTs
 * but still travels on a top-level form navigation. So every state-changing
 * request under `/api/orgs/**` and `/api/auth/**` must prove it came from our
 * own pages: its `Origin` header (or, when the browser sent none, `Referer`)
 * has to match the app origin. Browsers always attach `Origin` to cross-site
 * and same-site POSTs, so a request carrying neither is not a browser form
 * post and is refused too.
 *
 * Kept free of Next/Node imports so `src/middleware.ts` (edge runtime) and the
 * unit tests share one implementation.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Path prefixes whose non-GET requests carry the session cookie. `/api/public/**` (API-key) and `/api/cron/**` (secret header) are deliberately absent. */
const PROTECTED_PREFIXES = ["/api/orgs/", "/api/auth/"];

export function isCsrfProtectedRequest(method: string, pathname: string): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;
  return PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null; // includes the literal "null" origin sent by sandboxed/opaque contexts
  }
}

/** The origins this deployment answers to: the one the request arrived on (honouring a reverse proxy's forwarded headers) plus `APP_BASE_URL`. */
export function allowedOrigins(input: {
  requestUrl: string;
  host: string | null;
  forwardedHost: string | null;
  forwardedProto: string | null;
  appBaseUrl?: string | null;
}): Set<string> {
  const allowed = new Set<string>();
  const url = new URL(input.requestUrl);
  const proto = (input.forwardedProto?.split(",")[0].trim() || url.protocol.replace(":", "")).toLowerCase();
  const host = input.forwardedHost?.split(",")[0].trim() || input.host || url.host;
  const own = originOf(`${proto}://${host}`);
  if (own) allowed.add(own);
  const configured = originOf(input.appBaseUrl);
  if (configured) allowed.add(configured);
  return allowed;
}

/** True when the request's `Origin` (else `Referer`) is one of the allowed origins. */
export function isSameOriginRequest(
  headers: { origin: string | null; referer: string | null },
  allowed: Set<string>,
): boolean {
  if (headers.origin !== null) return allowed.has(originOf(headers.origin) ?? "");
  if (headers.referer !== null) return allowed.has(originOf(headers.referer) ?? "");
  return false;
}
