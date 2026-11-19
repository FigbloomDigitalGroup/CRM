import { NextResponse, type NextRequest } from "next/server";
import { allowedOrigins, isCsrfProtectedRequest, isSameOriginRequest } from "@/lib/csrf";
import { figbloomPageRedirect } from "@/auth/figbloom/pageRedirect";

/**
 * Two jobs, both before any page or route runs:
 *
 * 1. Figbloom sign-in (ERP/CRM_COGNITO_CONTRACT.md). With `COGNITO_SIGN_IN=on`, /login goes to Figbloom's sign-in page,
 *    and /forgot-password and /reset-password to its "Forgot password". The frozen pages themselves are not touched;
 *    with the switch off (the default) nothing here redirects.
 * 2. CSRF enforcement on the cookie-authenticated API (FIG-802); see `src/lib/csrf.ts` for the rule. Refusals use the
 *    standard error envelope so clients handle them like any other API error.
 *
 * Runs on the Node.js runtime so the switch is read on every request, not baked in when the image is built.
 */
export function middleware(request: NextRequest) {
  const redirect = figbloomPageRedirect(request.nextUrl.pathname, request.nextUrl.searchParams);
  if (redirect) return NextResponse.redirect(new URL(redirect, request.url));

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
  // because that module reaches the database client, which this file must not load.
  const requestId = crypto.randomUUID();
  const message = "Cross-origin request rejected: Origin does not match this app.";
  return NextResponse.json(
    { error: message, code: "CSRF_REJECTED", message, fieldErrors: [], requestId },
    { status: 403, headers: { "x-request-id": requestId } },
  );
}

export const config = {
  runtime: "nodejs",
  matcher: [
    "/api/orgs/:path*",
    "/api/auth/:path*",
    "/api/me/:path*",
    "/api/session/:path*",
    "/api/platform/:path*",
    "/login",
    "/forgot-password",
    "/reset-password",
  ],
};
