import { NextResponse, type NextRequest } from "next/server";
import { allowedOrigins, isCsrfProtectedRequest, isSameOriginRequest } from "@/lib/csrf";

/**
 * P1.02 (FIG-1124): every request gets one id, kept if the caller sent a usable one (same rule as `newRequestId` in `src/lib/apiErrors.ts`, repeated
 * here because that module cannot load in the edge runtime). It goes to the route on the request headers (so `handleRoute` and the logger use the same
 * id, with the path and method for the metrics) and back to the caller on the response.
 */
function requestIdFor(incoming: string | null): string {
  const clean = incoming?.trim();
  return clean && /^[A-Za-z0-9._:-]{8,128}$/.test(clean) ? clean : crypto.randomUUID();
}

function passThrough(request: NextRequest, requestId: string) {
  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);
  headers.set("x-fb-path", request.nextUrl.pathname);
  headers.set("x-fb-method", request.method);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("x-request-id", requestId);
  return res;
}

/**
 * One central place for CSRF enforcement on the cookie-authenticated API
 * (FIG-802); see `src/lib/csrf.ts` for the rule. Refusals use the standard
 * error envelope so clients handle them like any other API error.
 */
export function middleware(request: NextRequest) {
  const requestId = requestIdFor(request.headers.get("x-request-id"));
  if (!isCsrfProtectedRequest(request.method, request.nextUrl.pathname)) {
    return passThrough(request, requestId);
  }

  const allowed = allowedOrigins({
    requestUrl: request.url,
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    appBaseUrl: process.env.APP_BASE_URL,
  });
  const ok = isSameOriginRequest(
    { origin: request.headers.get("origin"), referer: request.headers.get("referer") },
    allowed,
  );
  if (ok) return passThrough(request, requestId);

  // Same shape as `buildErrorResponse` (src/lib/apiErrors.ts), built inline
  // because that module reaches the database client, which the edge runtime
  // this file runs in cannot load.
  const message = "Cross-origin request rejected: Origin does not match this app.";
  return NextResponse.json(
    { error: message, code: "CSRF_REJECTED", message, fieldErrors: [], requestId },
    { status: 403, headers: { "x-request-id": requestId } },
  );
}

export const config = {
  matcher: ["/api/orgs/:path*", "/api/auth/:path*", "/api/me/:path*", "/api/session/:path*", "/api/platform/:path*"],
};
