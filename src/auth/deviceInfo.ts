/**
 * What a sign-in looks like to the person reading their session list (B1.04):
 * a short device label ("Chrome on Windows") and a coarse place ("Nairobi,
 * KE"). Everything here is derived from request headers the platform already
 * sends; there is deliberately no external IP-lookup service (no extra
 * dependency, no IP addresses leaving the system).
 */

export interface ClientInfo {
  userAgent: string | null;
  ipAddress: string | null;
  place: string | null;
}

const EMPTY_CLIENT: ClientInfo = { userAgent: null, ipAddress: null, place: null };
export { EMPTY_CLIENT };

function browserOf(ua: string): string | null {
  if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/(Firefox|FxiOS)\//.test(ua)) return "Firefox";
  if (/(Chrome|CriOS)\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return "Safari";
  if (/^curl\//i.test(ua)) return "curl";
  return null;
}

function systemOf(ua: string): string | null {
  if (/Windows/.test(ua)) return "Windows";
  if (/(iPhone|iPad|iPod)/.test(ua)) return /iPad/.test(ua) ? "iPadOS" : "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Linux|X11/.test(ua)) return "Linux";
  return null;
}

/** "Chrome on Windows"; falls back gracefully when either part is unknown. */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").trim();
  if (!ua) return "Unknown device";
  const browser = browserOf(ua);
  const system = systemOf(ua);
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? "Unknown device";
}

/** True for loopback, link-local and RFC 1918 private addresses. */
export function isPrivateAddress(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const v = ip.trim().toLowerCase().replace(/^::ffff:/, "");
  if (v === "::1" || v === "localhost") return true;
  if (/^fe80:/.test(v) || /^f[cd][0-9a-f]{2}:/.test(v)) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(v);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

type HeaderReader = { get(name: string): string | null };

function clean(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v || v === "XX" || v === "T1") return null;
  let decoded = v;
  try {
    decoded = decodeURIComponent(v);
  } catch {
    /* keep the raw value */
  }
  return decoded.slice(0, 80);
}

/**
 * A coarse place from edge/proxy geo headers (Vercel, Cloudflare, or a generic
 * `x-geo-*` pair), "Local network" for private addresses, otherwise null.
 */
export function describePlace(ip: string | null, headers: HeaderReader): string | null {
  const city = clean(headers.get("x-vercel-ip-city") ?? headers.get("cf-ipcity") ?? headers.get("x-geo-city"));
  const country = clean(
    headers.get("x-vercel-ip-country") ?? headers.get("cf-ipcountry") ?? headers.get("x-geo-country"),
  );
  if (city && country) return `${city}, ${country}`;
  if (city ?? country) return (city ?? country) as string;
  if (isPrivateAddress(ip)) return "Local network";
  return null;
}
