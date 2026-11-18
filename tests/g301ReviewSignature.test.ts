/**
 * G3.01 independent security review (FIG-1191), e-signature of a quote (FIG-1186): the public token endpoint attacked from outside.
 * A passing test shows a defence holds. A test marked `it.fails` is a confirmed gap, written up in docs/M17_SECURITY_REVIEW_G3_01.md.
 */
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { computeSeal, sha256Hex, verifySignatureRecord, type SealFields } from "../src/lib/quoteSignature";
import { createQuote } from "../src/services/quoteService";
import { openQuoteLink, sendQuote } from "../src/services/quoteDocumentService";
import { getSigningPage, signQuote } from "../src/services/quoteSignatureService";
import { GET as publicGet, POST as publicPost } from "../src/app/api/public/sign/[token]/route";
import { GET as quoteGet } from "../src/app/api/public/quotes/[token]/route";
import { commercialWorld } from "./commercialFixtures";

const CLIENT = { ipAddress: "203.0.113.9", userAgent: "Mozilla/5.0 (review)" };
const SIGN = { signerName: "Grace Wanjiru", signerEmail: "grace@example.test", consent: true, signature: { kind: "TYPED" as const } };
const tokenOf = (link: string) => link.slice(link.lastIndexOf("/") + 1);

async function setRelease(orgId: string, release: "v1.1" | "v2") {
  await adminDb.organizationSetting.upsert({
    where: { organizationId_key: { organizationId: orgId, key: "release_override" } },
    update: { value: { release } },
    create: { organizationId: orgId, key: "release_override", value: { release } },
  });
}

async function sent(opts: { allowSigning?: boolean; catalogueName?: string } = {}) {
  const w = await commercialWorld();
  await setRelease(w.org.id, "v2");
  if (opts.catalogueName) await adminDb.catalogueItem.update({ where: { id: w.camera.id }, data: { name: opts.catalogueName } });
  const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 2 }] });
  const result = await sendQuote(w.sales, quote.id, 1, { to: "grace@example.test", allowSigning: opts.allowSigning ?? true });
  const versionId = (await adminDb.quoteVersion.findFirstOrThrow({ where: { quoteId: quote.id, version: 1 } })).id;
  return { w, quote, versionId, token: tokenOf(result.link) };
}

const call = (method: "GET" | "POST", token: string, body?: unknown, headers: Record<string, string> = { "x-real-ip": `198.51.100.${Math.floor(Math.random() * 200) + 1}` }, contentType = "application/json") =>
  (method === "GET" ? publicGet : publicPost)(
    new Request(`http://localhost/api/public/sign/${token}`, { method, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body), headers: { "user-agent": "review", ...(body !== undefined ? { "content-type": contentType } : {}), ...headers } }),
    { params: Promise.resolve({ token }) },
  );

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("G3.01 e-signature: the link token", () => {
  it("is 256 random bits, only its SHA-256 is stored, and the stored value cannot be used as a link", async () => {
    const a = await sent();
    const b = await sent();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a.token, "base64url").length).toBe(32);
    expect(a.token).not.toBe(b.token);
    const share = await adminDb.quoteShare.findFirstOrThrow({ where: { quoteVersionId: a.versionId } });
    expect(share.tokenHash).toBe(createHash("sha256").update(a.token).digest("hex"));
    expect(JSON.stringify(share)).not.toContain(a.token);
    // A reader of the database gets the hash, which is not a working link.
    expect((await call("GET", share.tokenHash)).status).toBe(404);
    expect((await call("GET", a.token)).status).toBe(200);
  });

  it("guessing, truncating, extending or re-casing a token finds nothing, and every miss looks the same", async () => {
    const { token } = await sent();
    const bodies = new Set<string>();
    for (const t of [token.slice(0, -1), token + "A", token.toLowerCase() === token ? token.toUpperCase() : token.toLowerCase(), "A".repeat(43), "..%2f..%2fadmin", "a".repeat(100), "a".repeat(101), token.replace(/.$/, "*")]) {
      const res = await call("GET", t);
      expect(res.status, t).toBe(404);
      const json = (await res.json()) as { code: string; message: string };
      bodies.add(`${json.code}|${json.message}`);
    }
    expect(bodies.size).toBe(1);
  });

  it("a signing link is dead when signing was not switched on for that link, and the quote link alone cannot sign", async () => {
    const { token } = await sent({ allowSigning: false });
    expect((await call("GET", token)).status).toBe(404);
    expect((await call("POST", token, SIGN)).status).toBe(404);
    expect((await quoteGet(new Request("http://localhost/x", { headers: { "x-real-ip": "198.51.100.1" } }), { params: Promise.resolve({ token }) })).status).toBe(200); // the view link still works
  });
});

describe("G3.01 e-signature: signing once, and only what was sent", () => {
  it("eight people signing the same link at the same moment produce exactly one signature, one acceptance and one timeline entry", async () => {
    const { token, versionId, w } = await sent();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => signQuote(token, { ...SIGN, signerName: `Racer Number${"abcdefgh"[i]}` }, CLIENT)));
    expect(results.filter((r) => r.status === "signed")).toHaveLength(1);
    expect(results.filter((r) => r.status === "already_signed")).toHaveLength(7);
    expect(await adminDb.quoteSignature.count({ where: { quoteVersionId: versionId } })).toBe(1);
    expect((await adminDb.quoteVersion.findUniqueOrThrow({ where: { id: versionId } })).status).toBe("ACCEPTED");
    expect(await adminDb.activity.count({ where: { organizationId: w.org.id, subject: { contains: "signed by" } } })).toBe(1);
    expect(await adminDb.auditEvent.count({ where: { organizationId: w.org.id, action: "quote.signed" } })).toBe(1);
  });

  it("a replay of the winning request answers 409 and changes nothing, from the route", async () => {
    const { token, versionId } = await sent();
    expect((await call("POST", token, SIGN)).status).toBe(201);
    const before = await adminDb.quoteSignature.findFirstOrThrow({ where: { quoteVersionId: versionId } });
    for (let i = 0; i < 3; i++) expect((await call("POST", token, { ...SIGN, signerName: "Second Person" })).status).toBe(409);
    expect(await adminDb.quoteSignature.findFirstOrThrow({ where: { quoteVersionId: versionId } })).toEqual(before);
  });

  it("the document signed is the one that was sent, and the seal ties the signature to it", async () => {
    const { token, versionId } = await sent();
    const share = await adminDb.quoteShare.findFirstOrThrow({ where: { quoteVersionId: versionId } });
    await signQuote(token, SIGN, CLIENT);
    const sig = await adminDb.quoteSignature.findFirstOrThrow({ where: { quoteVersionId: versionId } });
    expect(sig.documentSha256).toBe(share.documentSha256);
    expect(sha256Hex(share.documentHtml)).toBe(share.documentSha256);
    expect(verifySignatureRecord(sig, share.documentHtml).ok).toBe(true);
  });

  it("the stored version cannot be edited behind the client's back after sending: prices, terms and lines are locked by the database", async () => {
    const { versionId } = await sent();
    await expect(adminDb.$executeRawUnsafe(`UPDATE quote_versions SET total = 1 WHERE id = '${versionId}'`)).rejects.toThrow(/locked/i);
    await expect(adminDb.$executeRawUnsafe(`UPDATE quote_lines SET unit_price = 1 WHERE quote_version_id = '${versionId}'`)).rejects.toThrow(/locked/i);
    await expect(adminDb.$executeRawUnsafe(`UPDATE quote_shares SET document_html = 'x' WHERE quote_version_id = '${versionId}'`)).rejects.toThrow(/cannot be changed/i);
    await expect(adminDb.$executeRawUnsafe(`UPDATE quote_shares SET signing_enabled = false WHERE quote_version_id = '${versionId}'`)).rejects.toThrow(/cannot be changed/i);
  });

  it("an expired link cannot be revived by the client: expiry is read from the server's clock and the stored row only", async () => {
    const { token, versionId } = await sent();
    await adminDb.$executeRawUnsafe(`UPDATE quote_shares SET expires_at = now() - interval '1 second' WHERE quote_version_id = '${versionId}'`);
    expect((await call("POST", token, SIGN, undefined)).status).toBe(410);
    expect((await call("POST", token, { ...SIGN, expiresAt: "2099-01-01" })).status).toBe(400); // unknown fields are refused outright
    expect(await adminDb.quoteSignature.count({ where: { quoteVersionId: versionId } })).toBe(0);
  });

  it("an organisation moved below V2, or suspended, after the link went out, cannot be signed through it", async () => {
    const a = await sent();
    await setRelease(a.w.org.id, "v1.1");
    expect((await call("POST", a.token, SIGN)).status).toBe(404);
    const b = await sent();
    await adminDb.organization.update({ where: { id: b.w.org.id }, data: { status: "SUSPENDED" } });
    expect((await call("POST", b.token, SIGN)).status).toBe(404);
  });
});

describe("G3.01 e-signature: what the public page tells a stranger who holds the link", () => {
  it("shows the sender's prices to the client, and nothing internal: no cost, margin, ids of staff, or other quotes", async () => {
    const { token } = await sent();
    const page = await getSigningPage(token);
    expect(page.status).toBe("ok");
    const text = JSON.stringify(page);
    // The catalogue cost of the camera is 11000 and of the recorder 42000: neither may appear, nor any word for them.
    expect(text).not.toMatch(/cost|margin|ownerMembershipId|organizationId|createdBy|dealId|catalogueItemId|\b11000\b|\b22000\b|\b42000\b/i);
    expect(Object.keys((page as { page: object }).page).sort()).toEqual(
      ["company", "contact", "currency", "discountAmount", "discountPercent", "documentLanguage", "expiresAt", "lines", "organisationName", "quoteNumber", "recipientEmail", "subtotal", "terms", "total", "validUntil", "version"].sort(),
    );
    const html = (await openQuoteLink(token)) as { status: string; html?: string };
    // The style block contains the CSS word "margin"; only the document body is what a client reads.
    expect((html.html ?? "").split("</style>")[1] ?? "").not.toMatch(/cost|margin|\b11000\b|\b22000\b/i);
  });

  it("escapes a hostile product name in the client document and never serves it as markup", async () => {
    const { token } = await sent({ catalogueName: `<img src=x onerror=alert(1)>"'` });
    const res = await quoteGet(new Request("http://localhost/x", { headers: { "x-real-ip": "198.51.100.3" } }), { params: Promise.resolve({ token }) });
    const html = await res.text();
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("the public routes are not readable cross-origin, are never cached, and send no referrer", async () => {
    const { token } = await sent();
    const res = await call("GET", token);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("a malformed, oversized or wrongly typed body is a 4xx with no internals", async () => {
    const { token } = await sent();
    for (const body of ["{not json", "[]", "null", JSON.stringify({ ...SIGN, signerName: "A".repeat(10_000) }), JSON.stringify({ ...SIGN, signature: { kind: "DRAWN", data: "data:image/png;base64,AAAA" } }), JSON.stringify({ ...SIGN, signature: { kind: "DRAWN", data: "data:image/svg+xml;base64," + "A".repeat(100) } }), JSON.stringify({ ...SIGN, signerEmail: "a@b.c, d@e.f" })]) {
      const res = await call("POST", token, body);
      expect(res.status, body.slice(0, 40)).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(await res.text()).not.toMatch(/prisma|SELECT |\bat .*:\d+:\d+|node_modules/i);
    }
  });
});

describe("G3.01 e-signature: the client address and the rate limit", () => {
  it("the address stored with the signature is the one the trusted proxy appended, not one the signer wrote", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    const { token, versionId } = await sent();
    const res = await call("POST", token, SIGN, { "x-forwarded-for": "6.6.6.6, 203.0.113.77" });
    expect(res.status).toBe(201);
    expect((await adminDb.quoteSignature.findFirstOrThrow({ where: { quoteVersionId: versionId } })).ipAddress).toBe("203.0.113.77");
  });

  it("with no trusted proxy configured, a forged X-Forwarded-For is ignored for the record and for the limit", async () => {
    const { token, versionId } = await sent();
    const res = await call("POST", token, SIGN, { "x-forwarded-for": "6.6.6.6", "x-real-ip": "203.0.113.78" });
    expect(res.status).toBe(201);
    expect((await adminDb.quoteSignature.findFirstOrThrow({ where: { quoteVersionId: versionId } })).ipAddress).toBe("203.0.113.78");
  });

  it("the limit is 60 requests a minute per address, on opening and on signing, and cannot be dodged by a new first X-Forwarded-For entry", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    const { token } = await sent();
    const ip = "203.0.113.150";
    await adminDb.authRateLimitAttempt.createMany({ data: Array.from({ length: 60 }, () => ({ action: "QUOTE_SIGN" as const, scope: "ip", key: ip })) });
    expect((await call("GET", token, undefined, { "x-forwarded-for": ip })).status).toBe(429);
    expect((await call("POST", token, SIGN, { "x-forwarded-for": `1.2.3.${Math.floor(Math.random() * 250)}, ${ip}` })).status).toBe(429);
  });

  // FINDING (Low, shared by every public endpoint that limits by address): when no address can be read (TRUSTED_PROXY_HOPS unset and the platform
  // sends no X-Real-IP), `enforceRateLimit` skips every rule whose key is null, so the limit is silently off. The 256-bit token makes this harmless
  // for guessing a signing link, but the same fail-open applies to the public lead, form and quote-view endpoints.
  it.fails("a request with no readable address is still limited", async () => {
    const { token } = await sent();
    let limited = 0;
    for (let i = 0; i < 75; i++) if ((await call("GET", token, undefined, {})).status === 429) limited += 1;
    expect(limited).toBeGreaterThan(0);
  });
});

describe("G3.01 e-signature: names and the seal", () => {
  // FINDING (Low): a signer name may contain bidirectional-override characters (U+202E and friends) and spreadsheet formula starts. The name is
  // written to the deal timeline and the audit log and is shown to staff; an override can make "Grace Wanjiru" read as another string.
  // `cleanSignerName` refuses control characters (category Cc) and angle brackets only.
  it.fails("a signer name with a bidirectional override character is refused", async () => {
    const { token } = await sent();
    const res = await call("POST", token, { ...SIGN, signerName: "Grace ‮urijnaw" });
    expect(res.status).toBe(400);
  });

  it("(documents a limit, not a defence) the seal is an unkeyed hash: anyone who can write the database can forge a record that still verifies", () => {
    const forged: SealFields = {
      organizationId: "o", quoteId: "q", quoteVersionId: "v", shareId: "s", documentSha256: sha256Hex("<html>doc</html>"), signerName: "Someone Who Never Signed", signerEmail: null,
      signatureKind: "TYPED", signatureSha256: sha256Hex("Someone Who Never Signed"), consentText: "I agree", language: "en", ipAddress: null, userAgent: null, signedAt: new Date("2026-11-10T10:00:00Z"),
    };
    const record = { ...forged, sealSha256: computeSeal(forged), signatureData: "Someone Who Never Signed" };
    expect(verifySignatureRecord(record, "<html>doc</html>").ok).toBe(true);
  });
});
