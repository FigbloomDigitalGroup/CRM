import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { computeSeal, cleanSignatureInput, isPngDataUrl, sha256Hex, verifySignatureRecord, type SealFields } from "../src/lib/quoteSignature";
import { createNewVersion, createQuote } from "../src/services/quoteService";
import { getQuoteActivity, revokeQuoteShare, sendQuote } from "../src/services/quoteDocumentService";
import { getSigningPage, listQuoteSignatures, signQuote } from "../src/services/quoteSignatureService";
import { GET as publicGet, POST as publicPost } from "../src/app/api/public/sign/[token]/route";
import { commercialWorld } from "./commercialFixtures";

/** FIG-1186 (B7.04): e-signature of a sent quote. Integrity, expiry, immutability and isolation. */

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const CLIENT = { ipAddress: "203.0.113.9", userAgent: "Mozilla/5.0 (test)" };
const tokenOf = (link: string) => link.slice(link.lastIndexOf("/") + 1);
const SIGN = { signerName: "Grace Wanjiru", signerEmail: "Grace@Example.test", consent: true, signature: { kind: "TYPED" as const } };

async function setRelease(orgId: string, release: "v1.1" | "v2") {
  await adminDb.organizationSetting.upsert({
    where: { organizationId_key: { organizationId: orgId, key: "release_override" } },
    update: { value: { release } },
    create: { organizationId: orgId, key: "release_override", value: { release } },
  });
}

/** A V2 organisation with a quote sent to the client with an online signing link. */
async function sent(opts: { language?: string; linkExpiresInDays?: number; allowSigning?: boolean } = {}) {
  const w = await commercialWorld();
  await setRelease(w.org.id, "v2");
  const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 2 }] });
  const result = await sendQuote(w.sales, quote.id, 1, { to: "grace@example.test", language: opts.language, linkExpiresInDays: opts.linkExpiresInDays, allowSigning: opts.allowSigning ?? true });
  const versionId = (await adminDb.quoteVersion.findFirstOrThrow({ where: { quoteId: quote.id, version: 1 } })).id;
  return { w, quote, versionId, token: tokenOf(result.link), result };
}

async function issuesOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ValidationError) return err.issues ?? [];
    throw err;
  }
  throw new Error("Expected the call to be rejected.");
}

async function withTriggerOff<T>(table: string, trigger: string, fn: () => Promise<T>): Promise<T> {
  await adminDb.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER ${trigger}`);
  try {
    return await fn();
  } finally {
    await adminDb.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER ${trigger}`);
  }
}

describe("the seal and the signature rules (pure)", () => {
  const fields: SealFields = {
    organizationId: "o", quoteId: "q", quoteVersionId: "v", shareId: "s", documentSha256: "a".repeat(64), signerName: "Grace Wanjiru", signerEmail: null,
    signatureKind: "TYPED", signatureSha256: sha256Hex("Grace Wanjiru"), consentText: "I agree", language: "en", ipAddress: "203.0.113.9", userAgent: "ua", signedAt: new Date("2026-11-09T10:00:00Z"),
  };

  it("is stable, and every field changes it", () => {
    const base = computeSeal(fields);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(computeSeal({ ...fields })).toBe(base);
    const changes: Partial<SealFields>[] = [
      { organizationId: "o2" }, { quoteId: "q2" }, { quoteVersionId: "v2" }, { shareId: null }, { documentSha256: "b".repeat(64) }, { signerName: "Grace Wanjir" },
      { signerEmail: "g@x.co" }, { signatureKind: "DRAWN" }, { signatureSha256: "c".repeat(64) }, { consentText: "I agree." }, { language: "sw" }, { ipAddress: "203.0.113.10" },
      { userAgent: "ub" }, { signedAt: new Date("2026-11-09T10:00:01Z") },
    ];
    for (const c of changes) expect(computeSeal({ ...fields, ...c }), JSON.stringify(c)).not.toBe(base);
  });

  it("verifies a record and spots a changed record, signature or document", () => {
    const html = "<html>the quote</html>";
    const record = { ...fields, documentSha256: sha256Hex(html), signatureData: "Grace Wanjiru", sealSha256: "" };
    record.sealSha256 = computeSeal(record);
    expect(verifySignatureRecord(record, html)).toEqual({ sealValid: true, signatureValid: true, documentValid: true, ok: true });
    expect(verifySignatureRecord({ ...record, signerName: "Someone Else" }, html)).toMatchObject({ sealValid: false, ok: false });
    expect(verifySignatureRecord({ ...record, signatureData: "Other Person" }, html)).toMatchObject({ signatureValid: false, ok: false });
    expect(verifySignatureRecord(record, html + " ")).toMatchObject({ documentValid: false, ok: false });
    expect(verifySignatureRecord(record, null)).toMatchObject({ documentValid: false, ok: false });
  });

  it("cleans a signing request", () => {
    expect(cleanSignatureInput(SIGN)).toEqual({ value: { signerName: "Grace Wanjiru", signerEmail: "grace@example.test", signatureKind: "TYPED", signatureData: "Grace Wanjiru" } });
    expect(cleanSignatureInput({ ...SIGN, signerName: "  Grace   Wanjiru " })).toMatchObject({ value: { signerName: "Grace Wanjiru" } });
    const codes = (input: unknown) => ("issues" in cleanSignatureInput(input) ? (cleanSignatureInput(input) as { issues: { code: string }[] }).issues.map((i) => i.code) : []);
    expect(codes({ ...SIGN, signerName: "G" })).toEqual(["NAME_REQUIRED"]);
    expect(codes({ ...SIGN, signerName: "12" })).toEqual(["NAME_REQUIRED"]);
    expect(codes({ ...SIGN, signerName: "<b>Grace</b>" })).toEqual(["NAME_REQUIRED"]);
    expect(codes({ ...SIGN, consent: false })).toEqual(["CONSENT_REQUIRED"]);
    expect(codes({ ...SIGN, consent: "yes" })).toEqual(["CONSENT_REQUIRED"]);
    expect(codes({ ...SIGN, signerEmail: "not an email" })).toEqual(["INVALID_EMAIL"]);
    expect(codes({ ...SIGN, signature: { kind: "TYPED", data: "Another Name" } })).toEqual(["SIGNATURE_MISMATCH"]);
    expect(codes({ ...SIGN, signature: { kind: "SCRIBBLE" } })).toEqual(["INVALID_SIGNATURE_KIND"]);
    expect(codes({ ...SIGN, signature: { kind: "DRAWN", data: "data:image/png;base64,AAAA" } })).toEqual(["INVALID_SIGNATURE_IMAGE"]);
    expect(codes({ ...SIGN, signature: { kind: "DRAWN", data: "data:text/html;base64,PHNjcmlwdD4=" } })).toEqual(["INVALID_SIGNATURE_IMAGE"]);
    expect(codes(null)).toEqual(["NAME_REQUIRED", "CONSENT_REQUIRED"]);
    expect(cleanSignatureInput({ ...SIGN, signature: { kind: "DRAWN", data: PNG } })).toMatchObject({ value: { signatureKind: "DRAWN", signatureData: PNG } });
  });

  it("accepts only a real PNG image as a drawn signature", () => {
    expect(isPngDataUrl(PNG)).toBe(true);
    expect(isPngDataUrl(PNG.replace("iVBORw0KGgo", "R0lGODlhAQABAAAA"))).toBe(false); // a GIF header
    expect(isPngDataUrl(`data:image/png;base64,${"A".repeat(200_000)}`)).toBe(false);
    expect(isPngDataUrl("data:image/png;base64,!!!!!!!!!!!!!!!!!!!!!!!!!!")).toBe(false);
  });
});

describe("sending with a signing link", () => {
  it("creates a signing link with the quote link, only on release V2", async () => {
    const { result, token } = await sent({ language: "sw" });
    expect(result.signLink).toMatch(new RegExp(`/sign/${token}$`));
    expect(result.link).toContain(`/api/public/quotes/${token}`);
    const share = await adminDb.quoteShare.findFirstOrThrow({ where: { tokenHash: sha256Hex(token) } });
    expect(share).toMatchObject({ signingEnabled: true, language: "sw" });
    const mail = await adminDb.communication.findFirstOrThrow({ where: { organizationId: share.organizationId, channel: "EMAIL" } });
    expect(mail.summary + (mail.subject ?? "")).toBeDefined();
  });

  it("is refused below V2, with nothing sent or locked", async () => {
    const w = await commercialWorld(); // release V1.1
    const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 1 }] });
    const issues = await issuesOf(sendQuote(w.sales, quote.id, 1, { to: "grace@example.test", allowSigning: true }));
    expect(issues[0]).toMatchObject({ code: "SIGNING_NOT_AVAILABLE" });
    expect(await adminDb.quoteShare.count({ where: { organizationId: w.org.id } })).toBe(0);
    expect((await adminDb.quoteVersion.findFirstOrThrow({ where: { quoteId: quote.id } })).status).toBe("DRAFT");
  });

  it("a plain quote link cannot be used to sign", async () => {
    const { token } = await sent({ allowSigning: false });
    expect(await getSigningPage(token)).toEqual({ status: "not_found" });
    expect(await signQuote(token, SIGN, CLIENT)).toEqual({ status: "not_found" });
  });
});

describe("signing", () => {
  it("records one sealed signature, accepts the version, and leaves a trail", async () => {
    const { w, quote, versionId, token } = await sent();
    const open = await getSigningPage(token);
    expect(open.status).toBe("ok");
    if (open.status !== "ok") throw new Error("unreachable");
    expect(open.page).toMatchObject({ quoteNumber: quote.number, version: 1, total: 37000, documentLanguage: "en" });
    expect(JSON.stringify(open.page)).not.toMatch(/cost|margin/i);

    const now = new Date();
    const res = await signQuote(token, SIGN, CLIENT, now);
    expect(res).toMatchObject({ status: "signed", signerName: "Grace Wanjiru" });
    if (res.status !== "signed") throw new Error("unreachable");

    const version = await adminDb.quoteVersion.findFirstOrThrow({ where: { id: versionId } });
    expect(version).toMatchObject({ status: "ACCEPTED", respondedAt: now });
    const row = await adminDb.quoteSignature.findFirstOrThrow({ where: { quoteVersionId: versionId } });
    expect(row).toMatchObject({ signerName: "Grace Wanjiru", signerEmail: "grace@example.test", signatureKind: "TYPED", ipAddress: CLIENT.ipAddress, userAgent: CLIENT.userAgent, language: "en", sealSha256: res.sealSha256 });
    const share = await adminDb.quoteShare.findFirstOrThrow({ where: { tokenHash: sha256Hex(token) } });
    expect(row.documentSha256).toBe(share.documentSha256);
    expect(row.consentText).toMatch(/I agree/);

    expect(await adminDb.quoteEvent.count({ where: { quoteVersionId: versionId, type: "SIGNED" } })).toBe(1);
    const audit = await adminDb.auditEvent.findFirstOrThrow({ where: { organizationId: w.org.id, action: "quote.signed" } });
    expect(audit.entityId).toBe(quote.id);
    expect(JSON.stringify(audit.metadata)).toContain(res.sealSha256);
    expect(await adminDb.activity.count({ where: { organizationId: w.org.id, dealId: w.deal.id, subject: { contains: "signed by Grace Wanjiru" } } })).toBe(1);

    // The page now shows the signed state; the staff see the record and it verifies.
    expect(await getSigningPage(token)).toMatchObject({ status: "signed", signature: { signerName: "Grace Wanjiru", reference: res.sealSha256.slice(0, 12) } });
    const activity = await getQuoteActivity(w.sales, quote.id, 1);
    expect(activity.signaturesMasked).toBe(false);
    expect(activity.signatures).toHaveLength(1);
    expect(activity.signatures![0]).toMatchObject({ signerName: "Grace Wanjiru", sealSha256: res.sealSha256, verification: { ok: true } });
    expect((await listQuoteSignatures(w.management, quote.id, 1))[0]!.verification.ok).toBe(true);
  });

  it("keeps the language the client saw (Swahili consent wording)", async () => {
    const { versionId, token } = await sent({ language: "sw" });
    await signQuote(token, { ...SIGN, language: "sw" }, CLIENT);
    const row = await adminDb.quoteSignature.findFirstOrThrow({ where: { quoteVersionId: versionId } });
    expect(row.language).toBe("sw");
    expect(row.consentText).toMatch(/Nakubali/);
  });

  it("takes a drawn signature", async () => {
    const { versionId, token } = await sent();
    expect((await signQuote(token, { ...SIGN, signature: { kind: "DRAWN", data: PNG } }, CLIENT)).status).toBe("signed");
    expect(await adminDb.quoteSignature.findFirstOrThrow({ where: { quoteVersionId: versionId } })).toMatchObject({ signatureKind: "DRAWN", signatureData: PNG });
  });

  it("an incomplete request signs nothing", async () => {
    const { versionId, token } = await sent();
    expect((await issuesOf(signQuote(token, { ...SIGN, consent: false }, CLIENT))).map((i) => i.code)).toEqual(["CONSENT_REQUIRED"]);
    expect((await issuesOf(signQuote(token, { ...SIGN, signerName: "X" }, CLIENT))).map((i) => i.code)).toEqual(["NAME_REQUIRED"]);
    expect(await adminDb.quoteSignature.count({ where: { quoteVersionId: versionId } })).toBe(0);
    expect((await adminDb.quoteVersion.findFirstOrThrow({ where: { id: versionId } })).status).toBe("SENT");
  });

  it("signs once: the second attempt, even at the same moment, is refused", async () => {
    const { versionId, token } = await sent();
    const [a, b] = await Promise.all([signQuote(token, SIGN, CLIENT), signQuote(token, { ...SIGN, signerName: "Other Person" }, CLIENT)]);
    expect([a.status, b.status].sort()).toEqual(["already_signed", "signed"]);
    expect(await adminDb.quoteSignature.count({ where: { quoteVersionId: versionId } })).toBe(1);
    expect((await signQuote(token, SIGN, CLIENT)).status).toBe("already_signed");
  });
});

describe("links that must not sign", () => {
  it("an expired link is refused, logged once, and signs nothing", async () => {
    const { w, versionId, token } = await sent({ linkExpiresInDays: 1 });
    const later = new Date(Date.now() + 3 * 86_400_000);
    expect(await getSigningPage(token, later)).toMatchObject({ status: "expired" });
    const refused = await signQuote(token, SIGN, CLIENT, later);
    expect(refused.status).toBe("expired");
    await signQuote(token, SIGN, CLIENT, later);
    expect(await adminDb.quoteEvent.count({ where: { quoteVersionId: versionId, type: "SIGN_REFUSED" } })).toBe(1);
    expect(await adminDb.quoteSignature.count({ where: { organizationId: w.org.id } })).toBe(0);
    expect((await adminDb.quoteVersion.findFirstOrThrow({ where: { id: versionId } })).status).toBe("SENT");
  });

  it("a revoked link, an unknown token and a badly formed one look the same", async () => {
    const { w, quote, token } = await sent();
    const share = await adminDb.quoteShare.findFirstOrThrow({ where: { tokenHash: sha256Hex(token) } });
    await revokeQuoteShare(w.sales, quote.id, share.id);
    expect(await signQuote(token, SIGN, CLIENT)).toEqual({ status: "not_found" });
    expect(await getSigningPage(token)).toEqual({ status: "not_found" });
    expect(await getSigningPage("x".repeat(43))).toEqual({ status: "not_found" });
    expect(await getSigningPage("short")).toEqual({ status: "not_found" });
    expect(await getSigningPage("../../etc/passwd")).toEqual({ status: "not_found" });
  });

  it("a link replaced by a newer sent version, or on an organisation moved below V2, is dead", async () => {
    const a = await sent();
    const v2 = await createNewVersion(a.w.sales, a.quote.id, {});
    const second = await sendQuote(a.w.sales, a.quote.id, v2.version, { to: "grace@example.test", allowSigning: true });
    expect(await signQuote(a.token, SIGN, CLIENT)).toEqual({ status: "not_found" });
    expect((await getSigningPage(tokenOf(second.link))).status).toBe("ok");
    await setRelease(a.w.org.id, "v1.1");
    expect(await getSigningPage(tokenOf(second.link))).toEqual({ status: "not_found" });
  });

  it("a suspended organisation's link is dead", async () => {
    const { w, token } = await sent();
    await adminDb.organization.update({ where: { id: w.org.id }, data: { status: "SUSPENDED" } });
    expect(await getSigningPage(token)).toEqual({ status: "not_found" });
    expect(await signQuote(token, SIGN, CLIENT)).toEqual({ status: "not_found" });
  });

  it("a version already answered by a person is not signable", async () => {
    const { token, versionId } = await sent();
    await adminDb.quoteVersion.update({ where: { id: versionId }, data: { status: "DECLINED" } });
    expect(await getSigningPage(token)).toEqual({ status: "not_found" });
    expect(await signQuote(token, SIGN, CLIENT)).toEqual({ status: "not_found" });
  });
});

describe("integrity: a signed quote is immutable and verifiable", () => {
  async function signed() {
    const ctx = await sent();
    const res = await signQuote(ctx.token, SIGN, CLIENT);
    if (res.status !== "signed") throw new Error("not signed");
    const row = await adminDb.quoteSignature.findFirstOrThrow({ where: { quoteVersionId: ctx.versionId } });
    const share = await adminDb.quoteShare.findFirstOrThrow({ where: { tokenHash: sha256Hex(ctx.token) } });
    return { ...ctx, row, share };
  }

  it("the database refuses to change or delete a signature", async () => {
    const { row } = await signed();
    await expect(adminDb.quoteSignature.update({ where: { id: row.id }, data: { signerName: "Someone Else" } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(adminDb.quoteSignature.delete({ where: { id: row.id } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(adminDb.quoteSignature.updateMany({ where: { id: row.id }, data: { sealSha256: "0".repeat(64) } })).rejects.toThrow(/cannot be changed or deleted/);
  });

  it("the database refuses to change the sent document, its hash, link or language", async () => {
    const { share } = await signed();
    await expect(adminDb.quoteShare.update({ where: { id: share.id }, data: { documentHtml: "<p>edited</p>" } })).rejects.toThrow(/cannot be changed/);
    await expect(adminDb.quoteShare.update({ where: { id: share.id }, data: { documentSha256: "f".repeat(64) } })).rejects.toThrow(/cannot be changed/);
    await expect(adminDb.quoteShare.update({ where: { id: share.id }, data: { language: "sw" } })).rejects.toThrow(/cannot be changed/);
    await expect(adminDb.quoteShare.update({ where: { id: share.id }, data: { signingEnabled: false } })).rejects.toThrow(/cannot be changed/);
    // Views and the revoke time still move.
    await expect(adminDb.quoteShare.update({ where: { id: share.id }, data: { viewCount: { increment: 1 } } })).resolves.toBeDefined();
  });

  it("an accepted version cannot be reopened or its lines changed", async () => {
    const { versionId } = await signed();
    await expect(adminDb.quoteVersion.update({ where: { id: versionId }, data: { status: "SENT" } })).rejects.toThrow();
    await expect(adminDb.quoteVersion.update({ where: { id: versionId }, data: { status: "DECLINED" } })).rejects.toThrow();
    await expect(adminDb.quoteVersion.update({ where: { id: versionId }, data: { total: 1 } })).rejects.toThrow();
    await expect(adminDb.quoteLine.updateMany({ where: { quoteVersionId: versionId }, data: { unitPrice: 1 } })).rejects.toThrow();
  });

  it("a signature can be recorded only for a version that was sent", async () => {
    const w = await commercialWorld();
    const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 1 }] });
    const draft = await adminDb.quoteVersion.findFirstOrThrow({ where: { quoteId: quote.id } });
    const base = { organizationId: w.org.id, quoteId: quote.id, quoteVersionId: draft.id, signerName: "Grace Wanjiru", signatureKind: "TYPED", signatureData: "Grace Wanjiru", signatureSha256: "a".repeat(64), consentText: "I agree", documentSha256: "b".repeat(64), sealSha256: "c".repeat(64), signedAt: new Date() };
    await expect(adminDb.quoteSignature.create({ data: base })).rejects.toThrow(/only while it is SENT/);
  });

  it("tampering with a stored signature is detected by the check", async () => {
    const { w, quote, row } = await signed();
    await withTriggerOff("quote_signatures", "quote_signatures_guard", () => adminDb.quoteSignature.update({ where: { id: row.id }, data: { signerName: "Someone Else" } }));
    const [sig] = await listQuoteSignatures(w.management, quote.id, 1);
    expect(sig!.verification).toMatchObject({ sealValid: false, ok: false });
  });

  it("a replaced sent document is detected by the check, and signing is refused against it", async () => {
    const { w, quote, share } = await signed();
    await withTriggerOff("quote_shares", "quote_shares_guard", () => adminDb.quoteShare.update({ where: { id: share.id }, data: { documentHtml: `${share.documentHtml}<!-- edited -->` } }));
    const [sig] = await listQuoteSignatures(w.management, quote.id, 1);
    expect(sig!.verification).toMatchObject({ sealValid: true, documentValid: false, ok: false });

    const fresh = await sent();
    const freshShare = await adminDb.quoteShare.findFirstOrThrow({ where: { tokenHash: sha256Hex(fresh.token) } });
    await withTriggerOff("quote_shares", "quote_shares_guard", () => adminDb.quoteShare.update({ where: { id: freshShare.id }, data: { documentHtml: "<p>different</p>" } }));
    expect(await signQuote(fresh.token, SIGN, CLIENT)).toEqual({ status: "integrity_error" });
    expect(await adminDb.quoteSignature.count({ where: { quoteVersionId: fresh.versionId } })).toBe(0);
  });

  it("deleting the organisation still removes its signatures (a cascade)", async () => {
    const { w, row } = await signed();
    await adminDb.organization.delete({ where: { id: w.org.id } });
    expect(await adminDb.quoteSignature.findFirst({ where: { id: row.id } })).toBeNull();
  });
});

describe("who may see the record, and isolation between organisations", () => {
  it("another organisation cannot read a signature, in the service or in the database", async () => {
    const a = await sent();
    await signQuote(a.token, SIGN, CLIENT);
    const b = await commercialWorld();
    await setRelease(b.org.id, "v2");
    await expect(listQuoteSignatures(b.management, a.quote.id, 1)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getQuoteActivity(b.management, a.quote.id, 1)).rejects.toBeInstanceOf(NotFoundError);
    const seen = await withOrgContext(b.org.id, (tx) => tx.quoteSignature.findMany({ where: { quoteId: a.quote.id } }));
    expect(seen).toEqual([]);
    const own = await withOrgContext(a.w.org.id, (tx) => tx.quoteSignature.findMany({ where: { quoteId: a.quote.id } }));
    expect(own).toHaveLength(1);
    // A write for another organisation is refused by the row-level policy.
    await expect(
      withOrgContext(b.org.id, (tx) =>
        tx.quoteSignature.create({ data: { organizationId: a.w.org.id, quoteId: a.quote.id, quoteVersionId: a.versionId, signerName: "Mallory Smith", signatureKind: "TYPED", signatureData: "x", signatureSha256: "a".repeat(64), consentText: "x", documentSha256: "b".repeat(64), sealSha256: "c".repeat(64), signedAt: new Date() } }),
      ),
    ).rejects.toThrow();
  });

  it("the signed record follows the deal value rule: hidden value, hidden record", async () => {
    const { w, quote, token } = await sent();
    await signQuote(token, SIGN, CLIENT);
    const blind = { ...w.management, hiddenFields: ["deal.value"] };
    await expect(listQuoteSignatures(blind, quote.id, 1)).rejects.toBeInstanceOf(ForbiddenError);
    const activity = await getQuoteActivity(blind, quote.id, 1);
    expect(activity).toMatchObject({ signatures: null, signaturesMasked: true });
    expect(JSON.stringify(activity)).not.toContain("Grace Wanjiru");
    // The events still say a signature happened, without who or from where.
    expect(activity.events.map((e) => e.type)).toContain("SIGNED");
    const sighted = await getQuoteActivity(w.sales, quote.id, 1);
    expect(sighted.signatures).toHaveLength(1);
  });
});

describe("the public route", () => {
  const call = (method: "GET" | "POST", token: string, body?: unknown, ip = `198.51.100.${Math.floor(Math.random() * 200)}`) =>
    (method === "GET" ? publicGet : publicPost)(
      new Request(`http://localhost/api/public/sign/${token}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "x-forwarded-for": ip, "user-agent": "route-test" } }),
      { params: Promise.resolve({ token }) },
    );

  it("answers 404 for an unknown link in the standard envelope, and never caches", async () => {
    const res = await call("GET", "z".repeat(43));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("NOT_FOUND");
  });

  it("reads the page, signs with 201, then answers 409", async () => {
    const { token } = await sent({ language: "sw" });
    const page = await call("GET", token);
    expect(page.status).toBe(200);
    expect(page.headers.get("cache-control")).toBe("private, no-store");
    expect(await page.json()).toMatchObject({ status: "ok", page: { documentLanguage: "sw" } });
    const bad = await call("POST", token, { signerName: "G", consent: false });
    expect(bad.status).toBe(400);
    expect((await bad.json()).fieldErrors.map((f: { code: string }) => f.code).sort()).toEqual(["CONSENT_REQUIRED", "NAME_REQUIRED"]);
    const extra = await call("POST", token, { signerName: "Grace Wanjiru", consent: true, organizationId: "x" });
    expect(extra.status).toBe(400); // unknown fields are refused
    const ok = await call("POST", token, { signerName: "Route Tester", consent: true, signature: { kind: "TYPED" }, language: "sw" });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ status: "signed", signerName: "Route Tester" });
    const again = await call("POST", token, { signerName: "Grace Wanjiru", consent: true });
    expect(again.status).toBe(409);
    expect((await again.json()).code).toBe("ALREADY_ANSWERED");
    expect(await adminDb.quoteSignature.findFirstOrThrow({ where: { signerName: "Route Tester" } })).toMatchObject({ userAgent: "route-test" });
  });

  it("answers 410 for an expired link", async () => {
    const { token, versionId } = await sent({ linkExpiresInDays: 1 });
    await adminDb.$executeRawUnsafe(`UPDATE quote_shares SET expires_at = now() - interval '1 hour' WHERE quote_version_id = '${versionId}'`);
    const get = await call("GET", token);
    expect(get.status).toBe(410);
    expect((await get.json()).code).toBe("LINK_EXPIRED");
    const post = await call("POST", token, { signerName: "Grace Wanjiru", consent: true });
    expect(post.status).toBe(410);
    expect(await adminDb.quoteSignature.count({ where: { quoteVersionId: versionId } })).toBe(0);
  });
});
