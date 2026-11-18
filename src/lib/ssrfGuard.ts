import { lookup as dnsLookup } from "node:dns";
import { promises as dnsPromises } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

/**
 * Outbound request safety for webhooks (FIG-804): a customer-supplied URL must never be a way to reach our own network.
 *
 * Three layers, each of which holds on its own:
 *   1. `checkWebhookUrl` refuses a URL by its text (scheme, credentials, port, internal host names, literal private addresses).
 *   2. `resolvesToPublicAddress` refuses a host name that resolves to a private address, when a webhook is saved.
 *   3. `safeRequest` connects through its own `lookup`, which checks the address it is about to connect to. The check and the
 *      connection use the same answer, so a name that changes its address between check and use (DNS rebinding) is refused too.
 *      Redirects are never followed (a 3xx is an answer, not a path to another host), the body is capped and the request times out.
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
}

/** IPv4 ranges that are not the public internet: [address, prefix length]. */
const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including the cloud metadata address 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, and the broadcast address
];

function isBlockedV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return BLOCKED_V4.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    const start = ipv4ToInt(base);
    return n >= start && n < start + size;
  });
}

/** Expands an IPv6 address to eight 16-bit groups. Returns null when it is not a valid address. */
function expandV6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  // A trailing dotted IPv4 part (::ffff:1.2.3.4) becomes two groups.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    if (isIP(dotted[1]!) !== 4) return null;
    const v4 = ipv4ToInt(dotted[1]!);
    text = text.slice(0, text.length - dotted[1]!.length) + ((v4 >>> 16) & 0xffff).toString(16) + ":" + (v4 & 0xffff).toString(16);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function v4FromGroups(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function isBlockedV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true; // anything we cannot read is refused
  const allZeroUntil = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (allZeroUntil(7) && (g[7] === 0 || g[7] === 1)) return true; // :: and ::1
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0]! & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard prefix 100::/64
  // Addresses that carry an IPv4 address inside: judge the IPv4 address.
  if (allZeroUntil(5) && g[5] === 0xffff) return isBlockedV4(v4FromGroups(g[6]!, g[7]!)); // ::ffff:a.b.c.d
  if (allZeroUntil(6)) return isBlockedV4(v4FromGroups(g[6]!, g[7]!)); // ::a.b.c.d (deprecated compatible form)
  if (g[0] === 0x0064 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isBlockedV4(v4FromGroups(g[6]!, g[7]!)); // NAT64
  if (g[0] === 0x2002) return isBlockedV4(v4FromGroups(g[1]!, g[2]!)); // 6to4
  return false;
}

/** True when the address is on the public internet. Anything unreadable is not. */
export function isPublicAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return !isBlockedV4(address);
  if (kind === 6) return !isBlockedV6(address);
  return false;
}

const BLOCKED_HOST_SUFFIXES = [".local", ".localhost", ".internal", ".intranet", ".lan", ".home", ".corp", ".private", ".localdomain"];

export interface UrlPolicy {
  /** Plain `http://` is allowed (local development of a receiver). Never set from production code paths. */
  allowHttp?: boolean;
}

/** Checks a URL by its text. Returns the parsed URL, or throws `UnsafeUrlError` saying why in words a person can act on. */
export function checkWebhookUrl(raw: string, policy: UrlPolicy = {}): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError("Enter a full web address, for example https://example.com/hooks/figbloom.");
  }
  if (url.protocol !== "https:" && !(policy.allowHttp && url.protocol === "http:")) {
    throw new UnsafeUrlError("The web address must start with https://.");
  }
  if (url.username || url.password) throw new UnsafeUrlError("The web address must not contain a user name or password.");
  const defaultPort = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== defaultPort && Number(url.port) < 1024) {
    throw new UnsafeUrlError("Use port 443, or a port from 1024 up.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!host) throw new UnsafeUrlError("The web address has no host name.");
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new UnsafeUrlError("That address is on a private or internal network, so Figbloom will not send to it.");
    return url;
  }
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s)) || !host.includes(".")) {
    throw new UnsafeUrlError("That host name is internal, so Figbloom will not send to it. Use a public host name.");
  }
  // Numeric-looking names such as 2130706433 or 0x7f.1 are IPv4 addresses in disguise; the URL parser has normalised the common ones,
  // and the rest are refused here.
  if (/^[0-9x.]+$/i.test(host)) throw new UnsafeUrlError("The host name looks like a number, not a name.");
  return url;
}

export type Resolver = (host: string) => Promise<string[]>;

const systemResolver: Resolver = async (host) => (await dnsPromises.lookup(host, { all: true })).map((r) => r.address);

/** Refuses a host name that resolves to anything but public addresses (checked when a webhook is saved or changed). */
export async function resolvesToPublicAddress(url: URL, resolve: Resolver = systemResolver): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return; // `checkWebhookUrl` already judged it
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new UnsafeUrlError("That host name could not be found. Check the spelling.");
  }
  if (addresses.length === 0 || addresses.some((a) => !isPublicAddress(a))) {
    throw new UnsafeUrlError("That host name points to a private or internal network, so Figbloom will not send to it.");
  }
}

export interface SafeRequestOptions {
  method?: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  maxResponseBytes: number;
  allowHttp?: boolean;
  /** Test seam: replaces the system DNS answer. The result is still checked. */
  resolver?: Resolver;
}

export interface SafeResponse {
  status: number;
  /** Up to `maxResponseBytes` of the body, as text; for the delivery log only. */
  snippet: string;
}

/**
 * Sends one request to a customer-supplied URL. Never follows a redirect. The address connected to is the one `lookup` checked.
 * Throws `UnsafeUrlError` for a refused address and a plain Error for network failures and timeouts.
 */
export function safeRequest(rawUrl: string, options: SafeRequestOptions): Promise<SafeResponse> {
  const url = checkWebhookUrl(rawUrl, { allowHttp: options.allowHttp });
  const client = url.protocol === "https:" ? https : http;
  const resolver = options.resolver;
  return new Promise<SafeResponse>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const req = client.request(
      url,
      {
        method: options.method ?? "POST",
        headers: { ...options.headers, "content-length": String(Buffer.byteLength(options.body)) },
        agent: false,
        timeout: options.timeoutMs,
        // Checked at connect time, on the same answer the socket will use: this is what defeats DNS rebinding.
        lookup: (hostname, lookupOptions, callback) => {
          const done = (err: Error | null, addresses: Array<{ address: string; family: number }>) => {
            if (err) return callback(err, "", 0);
            const bad = addresses.find((a) => !isPublicAddress(a.address));
            if (bad || addresses.length === 0) return callback(new UnsafeUrlError("The host resolved to a private or internal address."), "", 0);
            const first = addresses[0]!;
            if ((lookupOptions as { all?: boolean }).all) return (callback as unknown as (e: null, a: unknown) => void)(null, addresses);
            return callback(null, first.address, first.family);
          };
          if (resolver) {
            resolver(hostname).then(
              (list) => done(null, list.map((address) => ({ address, family: isIP(address) }))),
              (err) => done(err as Error, []),
            );
            return;
          }
          dnsLookup(hostname, { all: true }, (err, list) => done(err, list ?? []));
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          if (size < options.maxResponseBytes) {
            chunks.push(chunk.subarray(0, options.maxResponseBytes - size));
            size += chunk.length;
          } else {
            // Enough: stop reading a body we only keep a snippet of.
            res.destroy();
          }
        });
        const end = () => finish(() => resolve({ status: res.statusCode ?? 0, snippet: Buffer.concat(chunks).toString("utf8").slice(0, options.maxResponseBytes) }));
        res.on("end", end);
        res.on("close", end);
        res.on("error", end);
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error(`No answer within ${Math.round(options.timeoutMs / 1000)} seconds.`));
    });
    req.on("error", (err) => finish(() => reject(err)));
    req.end(options.body);
  });
}
