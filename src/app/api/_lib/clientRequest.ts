import { describePlace, type ClientInfo } from "@/auth/deviceInfo";

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
  // X-Forwarded-For is client-controlled except for what our own proxies append, so it is read only when
  // TRUSTED_PROXY_HOPS says how many proxies are in front of us: the entry that many places from the right is the client.
  const hops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "", 10);
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (Number.isInteger(hops) && hops > 0 && forwardedFor) {
    const parts = forwardedFor.split(",").map((p) => p.trim()).filter(Boolean);
    const picked = parts[parts.length - hops];
    if (picked) return picked;
  }
  return request.headers.get("x-real-ip");
}

/** Device, address and coarse place of the caller, for session and sign-in records (B1.04). */
export function getClientInfo(request: Request): ClientInfo {
  const ipAddress = getClientIp(request);
  return {
    userAgent: request.headers.get("user-agent"),
    ipAddress,
    place: describePlace(ipAddress, request.headers),
  };
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
