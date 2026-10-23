import { NextResponse, type NextRequest } from "next/server";
import { allowedOrigins, isCsrfProtectedRequest, isSameOriginRequest } from "@/lib/csrf";

/**
 * One central place for CSRF enforcement on the cookie-authenticated API
 * (FIG-802); see `src/lib/csrf.ts` for the rule. Refusals use the standard
 * error envelope so clients handle them like any other API error.
 */
export function middleware(request: NextRequest) {
  if (!isCsrfProtectedRequest(request.method, request.nextUrl.pathname)) {
    return NextResponse.next();
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
  if (ok) return NextResponse.next();

  // Same shape as `buildErrorResponse` (src/lib/apiErrors.ts), built inline
  // because that module reaches the database client, which the edge runtime
  // this file runs in cannot load.
  const requestId = crypto.randomUUID();
  const message = "Cross-origin request rejected: Origin does not match this app.";
  return NextResponse.json(
    { error: message, code: "CSRF_REJECTED", message, fieldErrors: [], requestId },
    { status: 403, headers: { "x-request-id": requestId } },
  );
}

export const config = {
  matcher: ["/api/orgs/:path*", "/api/auth/:path*", "/api/me/:path*", "/api/session/:path*", "/api/platform/:path*"],
};
