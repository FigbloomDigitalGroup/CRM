/**
 * G3.01 independent security review (FIG-1191), webhooks: SSRF guard and signing, attacked from the outside.
 * No database and no outside host: every connection goes to a stub on 127.0.0.1 or is refused before it is made.
 * A passing test shows a defence holds. A test marked `it.fails` is a confirmed gap, written up in docs/M17_SECURITY_REVIEW_G3_01.md.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { UnsafeUrlError, checkWebhookUrl, isPublicAddress, resolvesToPublicAddress, safeRequest } from "../src/lib/ssrfGuard";
import { signWebhook, verifyWebhookSignature, webhookBackoffSeconds, WEBHOOK_TOLERANCE_SECONDS } from "../src/lib/webhookEvents";

describe("G3.01 SSRF: every spelling of an internal address is refused by text alone", () => {
  const refused = [
    // IPv4 spellings of loopback and the metadata address
    "https://0177.0.0.1/", // octal
    "https://0x7f000001/", // hex, whole address
    "https://017700000001/", // octal, whole address
    "https://127.0.0.1.:443/", // trailing dot
    "https://127。0。0。1/", // ideographic full stops, normalised by the URL parser
    "https://①②⑦.0.0.1/",
    "https://%31%32%37.0.0.1/", // percent-encoded digits
    "https://2852039166/", // 169.254.169.254 as one decimal number
    "https://0xA9FEA9FE/", // 169.254.169.254 as hex
    "https://169.254.169.254:443/latest/meta-data/iam/security-credentials/",
    "https://100.100.100.200/", // Alibaba metadata (carrier-grade NAT range)
    "https://192.0.0.192/", // Oracle metadata (IETF protocol assignments)
    "https://224.0.0.1/",
    "https://255.255.255.255/",
    "https://0/",
    "https://127.0.0.1:6379/", // loopback on a high port
    // IPv6 spellings
    "https://[::1]:8443/",
    "https://[0:0:0:0:0:0:0:1]/",
    "https://[0000:0000:0000:0000:0000:0000:0000:0001]/",
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:7f00:1]/",
    "https://[0:0:0:0:0:ffff:7f00:1]/",
    "https://[::ffff:169.254.169.254]/",
    "https://[::ffff:a9fe:a9fe]/",
    "https://[::127.0.0.1]/", // deprecated IPv4-compatible
    "https://[::7f00:1]/",
    "https://[64:ff9b::a9fe:a9fe]/", // NAT64 carrying the metadata address
    "https://[2002:a9fe:a9fe::1]/", // 6to4 carrying the metadata address
    "https://[fd00:ec2::254]/", // AWS IPv6 metadata (unique local)
    "https://[fe80::a9fe:a9fe]/",
    "https://[ff02::1]/",
    "https://[::]/",
    // userinfo, fragment and backslash tricks that fool a naive parser
    "https://hooks.example.com@127.0.0.1/",
    "https://hooks.example.com:pw@127.0.0.1/",
    "https://127.0.0.1#@hooks.example.com/", // the host is 127.0.0.1, the rest is a fragment
    "https://127.0.0.1?.hooks.example.com/",
    // names
    "https://LOCALHOST/",
    "https://localhost./",
    "https://foo.localhost/",
    "https://ｌｏｃａｌｈｏｓｔ/", // full-width letters, folded to localhost by IDNA
    "https://metadata.google.internal/",
    "https://app.corp/",
    "https://db.lan/",
    "https://router.home/",
    "https://kubernetes/", // no dot
  ];
  for (const url of refused) {
    it(`refuses ${url}`, () => {
      expect(() => checkWebhookUrl(url)).toThrow(UnsafeUrlError);
    });
  }

  it("refuses plain http, other schemes, a privileged port and credentials", () => {
    for (const url of ["http://hooks.example.com/", "https://hooks.example.com:80/", "https://hooks.example.com:25/", "gopher://hooks.example.com/", "file:///etc/passwd", "data:text/plain,hi", "wss://hooks.example.com/", "https://u@hooks.example.com/"]) {
      expect(() => checkWebhookUrl(url), url).toThrow(UnsafeUrlError);
    }
  });

  it("does not refuse an ordinary public address, so the guard is not simply refusing everything", () => {
    for (const url of ["https://hooks.example.com/x", "https://93.184.216.34/", "https://[2606:4700:4700::1111]/", "https://hooks.example.com:8443/x"]) {
      expect(() => checkWebhookUrl(url), url).not.toThrow();
    }
  });

  it("classifies the address ranges an attacker would aim at", () => {
    const internal = ["127.255.255.254", "10.255.255.255", "172.31.255.255", "192.168.255.255", "169.254.0.1", "100.127.255.255", "198.18.0.1", "0.1.2.3", "::ffff:0a00:0001", "::ffff:c0a8:0101", "fc00::", "fdff::1", "febf::1", "2001:db8::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2"];
    for (const a of internal) expect(isPublicAddress(a), a).toBe(false);
    const external = ["8.8.8.8", "172.32.0.1", "172.15.255.255", "100.63.255.255", "100.128.0.1", "169.255.0.1", "11.0.0.1", "2606:4700::1111", "::ffff:808:808"];
    for (const a of external) expect(isPublicAddress(a), a).toBe(true);
  });

  // The site-local range fec0::/10 (deprecated, RFC 3879) is not in the blocked list: only fe80::/10 is. Nothing routes it on the public internet,
  // so this is hygiene, not an exploitable hole, and is reported as Low in the review. The test states the safe behaviour.
  it.fails("also refuses the deprecated site-local range fec0::/10 and the local-use NAT64 prefix 64:ff9b:1::/48 (Low, hygiene)", () => {
    expect(isPublicAddress("fec0::1")).toBe(false);
    expect(isPublicAddress("64:ff9b:1::7f00:1")).toBe(false);
  });

  it("refuses a host name that resolves to any internal address, including a mixed answer and the IPv6 forms", async () => {
    const url = new URL("https://attacker-controlled.example.com/");
    for (const answer of [["127.0.0.1"], ["93.184.216.34", "10.0.0.1"], ["::1"], ["::ffff:127.0.0.1"], ["169.254.169.254"], []]) {
      await expect(resolvesToPublicAddress(url, async () => answer), JSON.stringify(answer)).rejects.toBeInstanceOf(UnsafeUrlError);
    }
    await expect(resolvesToPublicAddress(url, async () => ["93.184.216.34", "2606:4700::1111"])).resolves.toBeUndefined();
  });
});

describe("G3.01 SSRF: the connection itself (DNS rebinding, redirects, response size, timeouts)", () => {
  async function stub(handler: http.RequestListener) {
    let hits = 0;
    const server = http.createServer((req, res) => {
      hits += 1;
      handler(req, res);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    return { port: (server.address() as AddressInfo).port, hits: () => hits, close: () => new Promise((r) => server.close(r)) };
  }
  // safeRequest refuses an unsafe address by throwing before it returns a promise; the delivery code calls it inside a try, so both read the same.
  const attempt = async (...args: Parameters<typeof safeRequest>) => safeRequest(...args);
  const base = { headers: {}, body: "{}", timeoutMs: 3000, maxResponseBytes: 64, allowHttp: true };

  it("a name whose answer is internal at connect time is refused on the answer actually used (rebinding), repeatedly, and nothing is sent", async () => {
    const s = await stub((_q, res) => res.end("secret"));
    try {
      // Only internal answers are used here: a public answer would make a real outside connection, which this review does not do.
      for (const answer of [["127.0.0.1"], ["::1"], ["::ffff:127.0.0.1"], ["10.0.0.5", "127.0.0.1"]]) {
        await expect(attempt(`http://flip.example.com:${s.port}/`, { ...base, timeoutMs: 400, resolver: async () => answer })).rejects.toBeInstanceOf(UnsafeUrlError);
      }
      expect(s.hits()).toBe(0);
    } finally {
      await s.close();
    }
  });

  it("an IP-literal host is judged by its text and never reaches the stub on loopback", async () => {
    const s = await stub((_q, res) => res.end("secret"));
    try {
      await expect(attempt(`http://127.0.0.1:${s.port}/`, base)).rejects.toBeInstanceOf(UnsafeUrlError);
      await expect(attempt(`http://[::1]:${s.port}/`, base)).rejects.toBeInstanceOf(UnsafeUrlError);
      await expect(attempt(`http://[::ffff:127.0.0.1]:${s.port}/`, base)).rejects.toBeInstanceOf(UnsafeUrlError);
      expect(s.hits()).toBe(0);
    } finally {
      await s.close();
    }
  });

  it("allowHttp is off by default: a plain http receiver is refused even at a public address (no connection is made)", async () => {
    await expect(attempt("http://93.184.216.34/", { headers: {}, body: "{}", timeoutMs: 500, maxResponseBytes: 64 })).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("the guard has no follow-redirect path (source check)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/lib/ssrfGuard.ts", "utf8");
    // node:http / node:https never follow redirects on their own; the guard must not add a library that does.
    expect(source).not.toMatch(/follow-redirects|maxRedirects|redirect:\s*["']follow["']|fetch\(/);
  });

  // Not exercised: a live connection to a public address (redirect behaviour, the response-size cap, the idle timeout) needs an outside host,
  // which this review does not contact. They are read from source and listed under "not checked" in docs/M17_SECURITY_REVIEW_G3_01.md.
});

describe("G3.01 webhook signing: HMAC, replay window, constant-time comparison", () => {
  const secret = "whsec_testsecret";
  const body = JSON.stringify({ id: "e1", type: "deal.won", data: { deal: { id: "d1" } } });
  const now = 1_800_000_000;

  it("verifies a good delivery, and refuses a changed body, a changed timestamp, a wrong secret and a replay outside the window", () => {
    const sig = signWebhook(secret, now, body);
    expect(verifyWebhookSignature({ secret, timestamp: String(now), signature: sig, rawBody: body, nowSeconds: now })).toEqual({ ok: true });
    expect(verifyWebhookSignature({ secret, timestamp: String(now), signature: sig, rawBody: body + " ", nowSeconds: now })).toMatchObject({ ok: false, reason: "mismatch" });
    expect(verifyWebhookSignature({ secret, timestamp: String(now + 1), signature: sig, rawBody: body, nowSeconds: now })).toMatchObject({ ok: false, reason: "mismatch" });
    expect(verifyWebhookSignature({ secret: "whsec_other", timestamp: String(now), signature: sig, rawBody: body, nowSeconds: now })).toMatchObject({ ok: false, reason: "mismatch" });
    // A captured delivery replayed later, or stamped in the future, is refused before the signature is even compared.
    expect(verifyWebhookSignature({ secret, timestamp: String(now), signature: sig, rawBody: body, nowSeconds: now + WEBHOOK_TOLERANCE_SECONDS + 1 })).toMatchObject({ ok: false, reason: "stale" });
    expect(verifyWebhookSignature({ secret, timestamp: String(now + 3600), signature: sig, rawBody: body, nowSeconds: now })).toMatchObject({ ok: false, reason: "stale" });
  });

  it("refuses missing, malformed and truncated values without throwing", () => {
    const sig = signWebhook(secret, now, body);
    for (const input of [
      { timestamp: null, signature: sig },
      { timestamp: String(now), signature: null },
      { timestamp: "abc", signature: sig },
      { timestamp: "1.5", signature: sig },
      { timestamp: String(now), signature: sig.slice(0, -1) },
      { timestamp: String(now), signature: "" },
      { timestamp: String(now), signature: sig + "00" },
      { timestamp: String(now), signature: "v1=" + "0".repeat(64) },
    ]) {
      const r = verifyWebhookSignature({ secret, rawBody: body, nowSeconds: now, ...input });
      expect(r.ok).toBe(false);
    }
  });

  it("the signature covers the timestamp: the same body signed at another time differs, so a captured body cannot be re-stamped", () => {
    expect(signWebhook(secret, now, body)).not.toBe(signWebhook(secret, now + 1, body));
  });

  it("backoff grows, is capped at six hours, and never goes below one minute", () => {
    expect(webhookBackoffSeconds(1)).toBe(60);
    expect(webhookBackoffSeconds(2)).toBe(180);
    expect(webhookBackoffSeconds(50)).toBe(6 * 3600);
    expect(webhookBackoffSeconds(0)).toBeGreaterThanOrEqual(60);
  });
});
