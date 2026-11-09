import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROLES } from "../prisma/seedData";
import { adminDb } from "../src/db/adminClient";
import { RESEND_ENDPOINT, ResendError, sendWithResend } from "../src/integrations/email/resend";
import { ApiError } from "../src/lib/apiErrors";
import { RateLimitedError, ValidationError } from "../src/auth/errors";
import {
  MAX_MESSAGE,
  MAX_SUBJECT,
  MEMBER_HOURLY_LIMIT,
  ORGANISATION_HOURLY_LIMIT,
  composeSupportEmail,
  createSupportRequest,
  newSupportReference,
  validateSupportRequest,
} from "../src/services/supportRequestService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

/** Support requests by email through Resend (docs/SUPPORT_BY_EMAIL.md, decision 12). No call here reaches the real Resend. */

const KEY = "re_test_key_not_a_real_secret";
const FROM = "Figbloom CRM <support-requests@mail.example.test>";
const INBOX = "support@figbloom.example.test";

interface Captured {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function fakeFetch(respond: () => Response = () => new Response(JSON.stringify({ id: "resend-msg-1" }), { status: 200 })) {
  const calls: Captured[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return respond();
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

beforeEach(() => {
  vi.stubEnv("SUPPORT_EMAIL_FROM", FROM);
  vi.stubEnv("SUPPORT_INBOX_EMAIL", INBOX);
  vi.stubEnv("RESEND_API_KEY", KEY);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("validation", () => {
  it("needs a subject and a message, and cleans both", () => {
    expect(() => validateSupportRequest({ subject: "  ", message: "x" })).toThrow(ValidationError);
    expect(() => validateSupportRequest({ subject: "x", message: " \n " })).toThrow(ValidationError);
    const ok = validateSupportRequest({ subject: "Cannot\r\nBcc: evil@example.test sign in", message: "Line one\r\nLine two\u0000" });
    expect(ok.subject).toBe("Cannot Bcc: evil@example.test sign in");
    expect(ok.subject).not.toMatch(/[\r\n]/);
    expect(ok.message).toBe("Line one\nLine two");
    expect(ok.category).toBe("QUESTION");
    expect(ok.urgency).toBe("NORMAL");
  });

  it("enforces the length limits and the choice lists", () => {
    expect(() => validateSupportRequest({ subject: "s".repeat(MAX_SUBJECT + 1), message: "m" })).toThrow(ValidationError);
    expect(() => validateSupportRequest({ subject: "s", message: "m".repeat(MAX_MESSAGE + 1) })).toThrow(ValidationError);
    expect(() => validateSupportRequest({ subject: "s", message: "m", category: "NOPE" })).toThrow(ValidationError);
    expect(() => validateSupportRequest({ subject: "s", message: "m", urgency: "PANIC" })).toThrow(ValidationError);
  });

  it("keeps only a path from the page: no full address, no query string, no fragment", () => {
    expect(validateSupportRequest({ subject: "s", message: "m", pagePath: "/o/acme/deals/1?token=secret#x" }).pagePath).toBe("/o/acme/deals/1");
    expect(() => validateSupportRequest({ subject: "s", message: "m", pagePath: "https://evil.example.test/" })).toThrow(ValidationError);
    expect(() => validateSupportRequest({ subject: "s", message: "m", pagePath: "//evil.example.test" })).toThrow(ValidationError);
  });

  it("makes references that can be read aloud", () => {
    const at = new Date("2026-11-05T10:00:00Z");
    const refs = new Set(Array.from({ length: 200 }, () => newSupportReference(at)));
    for (const r of refs) expect(r).toMatch(/^FB-20261105-[2-9A-HJKMNP-Z]{6}$/);
    expect(refs.size).toBeGreaterThan(190);
  });
});

describe("the email", () => {
  const compose = (over: Partial<Parameters<typeof validateSupportRequest>[0]> = {}) =>
    composeSupportEmail({
      config: { from: FROM, inbox: INBOX },
      reference: "FB-20261105-ABCDEF",
      request: validateSupportRequest({ subject: "Export fails", message: "It says error.", category: "PROBLEM", urgency: "URGENT", pagePath: "/o/acme/reports", ...over }),
      member: { name: "Amina Otieno", email: "amina@acme.example.test", roleName: "Sales" },
      organization: { id: "org-1", name: "Acme", slug: "acme" },
      at: new Date("2026-11-05T10:00:00Z"),
    });

  it("goes to the support inbox with the member as Reply-To and the reference in the subject", () => {
    const m = compose();
    expect(m.to).toEqual([INBOX]);
    expect(m.from).toBe(FROM);
    expect(m.replyTo).toBe("amina@acme.example.test");
    expect(m.subject).toBe("[URGENT] [FB-20261105-ABCDEF] Export fails");
    expect(m.headers).toMatchObject({ "X-Figbloom-Support-Reference": "FB-20261105-ABCDEF", "X-Figbloom-Organization-Id": "org-1", "X-Figbloom-Organization-Slug": "acme" });
    expect(m.tags).toEqual([{ name: "kind", value: "support_request" }, { name: "category", value: "problem" }]);
  });

  it("says who, where and when, and carries nothing about deals", () => {
    const m = compose({ urgency: "NORMAL" });
    expect(m.subject).toBe("[FB-20261105-ABCDEF] Export fails");
    expect(m.text).toContain("It says error.");
    expect(m.text).toContain("Amina Otieno <amina@acme.example.test> (Sales)");
    expect(m.text).toContain("Acme (acme)");
    expect(m.text).toContain("/o/acme/reports");
    expect(m.text).toContain("2026-11-05T10:00:00.000Z");
    expect(m.text).not.toMatch(/KES|margin|payment|invoice/i);
  });
});

describe("the Resend adapter", () => {
  const message = { from: FROM, to: [INBOX], subject: "s", text: "t", replyTo: "a@b.example.test", headers: { "X-A": "1" }, tags: [{ name: "k", value: "v" }] };

  it("posts the documented request with the key and the idempotency key", async () => {
    const { calls, fetchImpl } = fakeFetch();
    const sent = await sendWithResend(message, { fetchImpl, apiKey: KEY, idempotencyKey: "idem-1" });
    expect(sent).toEqual({ id: "resend-msg-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(RESEND_ENDPOINT);
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", "Idempotency-Key": "idem-1" });
    expect(calls[0]!.body).toEqual({ from: FROM, to: [INBOX], subject: "s", text: "t", reply_to: "a@b.example.test", headers: { "X-A": "1" }, tags: [{ name: "k", value: "v" }] });
  });

  it("maps a refusal to an error that holds the status and Resend's error name, never the key or the body", async () => {
    const { fetchImpl } = fakeFetch(() => new Response(JSON.stringify({ name: "validation_error", message: `bad ${KEY}` }), { status: 422 }));
    const err = await sendWithResend(message, { fetchImpl, apiKey: KEY }).catch((e) => e);
    expect(err).toBeInstanceOf(ResendError);
    expect(err.status).toBe(422);
    expect(err.resendName).toBe("validation_error");
    expect(String(err.message)).not.toContain(KEY);
  });

  it("maps a network failure and a missing key to errors with no status", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const err = await sendWithResend(message, { fetchImpl: down, apiKey: KEY }).catch((e) => e);
    expect(err).toBeInstanceOf(ResendError);
    expect(err.status).toBeNull();
    vi.stubEnv("RESEND_API_KEY", "");
    await expect(sendWithResend(message)).rejects.toBeInstanceOf(ResendError);
  });
});

describe("creating a request (database)", () => {
  const ask = { subject: "Cannot export", message: "Nothing happens when I click Export.", category: "PROBLEM", pagePath: "/o/acme/reports" };

  it("sends one email for the member, with the member's address as Reply-To, and audits it without the words", async () => {
    const org = await createTestOrganization("SupportReq");
    const ctx = await createTestContext(org.id, "SALES", "sr.sales");
    const user = await adminDb.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    const { calls, fetchImpl } = fakeFetch();

    const result = await createSupportRequest(ctx, ask, { send: { fetchImpl, apiKey: KEY } });
    expect(result.sent).toBe(true);
    expect(result.reference).toMatch(/^FB-\d{8}-[2-9A-HJKMNP-Z]{6}$/);

    expect(calls).toHaveLength(1);
    const body = calls[0]!.body;
    expect(body.reply_to).toBe(user.email);
    expect(body.to).toEqual([INBOX]);
    expect(String(body.subject)).toContain(result.reference);
    expect(String(body.text)).toContain("Nothing happens when I click Export.");
    expect(String(body.text)).toContain(org.slug);
    expect((calls[0]!.init.headers as Record<string, string>)["Idempotency-Key"]).toBe(`support-${result.reference}`);

    const audit = await adminDb.auditEvent.findFirstOrThrow({ where: { organizationId: org.id, action: "support.request_sent" } });
    expect(audit.entityId).toBe(result.reference);
    expect(audit.actorMembershipId).toBe(ctx.membershipId);
    expect(audit.metadata).toMatchObject({ reference: result.reference, category: "PROBLEM", urgency: "NORMAL", resendId: "resend-msg-1" });
    const stored = JSON.stringify(audit);
    expect(stored).not.toContain("Cannot export");
    expect(stored).not.toContain("Nothing happens");
  });

  it("lets every role ask for help", async () => {
    const org = await createTestOrganization("SupportRoles");
    for (const role of ROLES) {
      const ctx = await createTestContext(org.id, role.key, `sr.${role.key.toLowerCase()}`);
      const { fetchImpl } = fakeFetch();
      await expect(createSupportRequest(ctx, ask, { send: { fetchImpl, apiKey: KEY } }), role.key).resolves.toMatchObject({ sent: true });
    }
  });

  it("answers 503 and sends nothing when Resend refuses, without showing the cause", async () => {
    const org = await createTestOrganization("SupportRefused");
    const ctx = await createTestContext(org.id, "SALES", "sr.refused");
    const { calls, fetchImpl } = fakeFetch(() => new Response(JSON.stringify({ name: "invalid_api_key" }), { status: 403 }));
    const err = await createSupportRequest(ctx, ask, { send: { fetchImpl, apiKey: KEY } }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(503);
    expect(String(err.message)).not.toMatch(/invalid_api_key|403|re_/);
    expect(calls).toHaveLength(1);
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "support.request_sent" } })).toBe(0);
  });

  it("in production, answers 503 when email is not set up; in development, logs and reports sent: false", async () => {
    const org = await createTestOrganization("SupportUnset");
    const ctx = await createTestContext(org.id, "SALES", "sr.unset");
    vi.stubEnv("RESEND_API_KEY", "");

    vi.stubEnv("NODE_ENV", "production");
    const err = await createSupportRequest(ctx, ask).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(503);
    expect(String(err.message)).toContain("not set up");

    vi.stubEnv("NODE_ENV", "development");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(createSupportRequest(ctx, ask)).resolves.toMatchObject({ sent: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("limits a member to a few requests an hour, and one member's use does not block a colleague", async () => {
    const org = await createTestOrganization("SupportLimit");
    const busy = await createTestContext(org.id, "SALES", "sr.busy");
    const calm = await createTestContext(org.id, "DELIVERY", "sr.calm");
    const { fetchImpl } = fakeFetch();
    for (let i = 0; i < MEMBER_HOURLY_LIMIT; i++) await createSupportRequest(busy, ask, { send: { fetchImpl, apiKey: KEY } });
    await expect(createSupportRequest(busy, ask, { send: { fetchImpl, apiKey: KEY } })).rejects.toBeInstanceOf(RateLimitedError);
    await expect(createSupportRequest(calm, ask, { send: { fetchImpl, apiKey: KEY } })).resolves.toMatchObject({ sent: true });
  });

  it("limits an organisation to twenty requests an hour across its members", async () => {
    const org = await createTestOrganization("SupportOrgLimit");
    const { fetchImpl } = fakeFetch();
    for (let i = 0; i < ORGANISATION_HOURLY_LIMIT; i++) {
      const member = await createTestContext(org.id, "SALES", `sr.org${i}`);
      await createSupportRequest(member, ask, { send: { fetchImpl, apiKey: KEY } });
    }
    const late = await createTestContext(org.id, "SALES", "sr.orglate");
    await expect(createSupportRequest(late, ask, { send: { fetchImpl, apiKey: KEY } })).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("refuses a bad request before anything is sent", async () => {
    const org = await createTestOrganization("SupportBad");
    const ctx = await createTestContext(org.id, "SALES", "sr.bad");
    const { calls, fetchImpl } = fakeFetch();
    await expect(createSupportRequest(ctx, { subject: "", message: "" }, { send: { fetchImpl, apiKey: KEY } })).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(0);
  });
});
