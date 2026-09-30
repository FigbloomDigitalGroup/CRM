/**
 * Best-effort client IP extraction for rate limiting (FIG-594). Next.js
 * Route Handlers don't expose the socket's remote address directly --
 * `x-forwarded-for` (set by the platform's reverse proxy/load balancer in
 * any real deployment) is the standard way to get it. Local dev with no
 * proxy in front has neither header, so this can legitimately return null;
 * callers must treat that as "can't rate-limit by IP for this request",
 * not as a free pass.
 */
export function getClientIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip");
}

/** The request's Origin header, falling back to Referer's origin. */
export function getRequestOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (origin) return origin;

  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}
