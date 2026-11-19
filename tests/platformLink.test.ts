import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CRM in Figbloom's console (ERP/CRM_PLATFORM_CONTRACT.md): organisations registered with the platform (sent at once,
 * retried with backoff), suspended and reactivated by the console's decisions, summarised for the console and created
 * from it. The platform is stubbed; CRM runs against the real test database.
 */

const platform = vi.hoisted(() => ({
  putOrganization: vi.fn(),
  putTenant: vi.fn(),
  putDecisionWebhook: vi.fn(),
  createUser: vi.fn(),
  markEmailVerified: vi.fn(),
}));
vi.mock("../src/auth/figbloom/platformClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth/figbloom/platformClient")>()),
  platformClient: () => platform,
}));

import { OrganizationSuspendedError, UnauthorizedError } from "../src/auth/errors";
import { resolveRequestContext, type CookieReader } from "../src/auth/requestContext";
import { createSession, lookupSession, SESSION_COOKIE_NAME } from "../src/auth/session";
import { generateWebsiteApiKey, resolveWebsitePublicContext } from "../src/auth/websiteApiKey";
import { isCsrfProtectedRequest } from "../src/lib/csrf";
import { adminDb } from "../src/db/adminClient";
import {
  applyPlatformDecision,
  backoffMs,
  organizationChanged,
  runPlatformSync,
  UnknownOrganizationError,
  verifyPlatformSignature,
} from "../src/services/platformLinkService";
import {
  consoleSecretMatches,
  createOrganizationFromConsole,
  getOrganizationSummary,
  slugFor,
} from "../src/services/platformConsoleService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

const ENV = { PLATFORM_LINK_ENABLED: "true", PLATFORM_CONSOLE_SECRET: "console-secret-for-tests", PLATFORM_WEBHOOK_SECRET: "webhook-secret-for-tests" };
const cookieReaderFrom = (entries: Record<string, string>): CookieReader => ({
  get: (name: string) => (name in entries ? { value: entries[name]! } : undefined),
});
const sign = (body: string, ts = String(Math.floor(Date.now() / 1000)), secret = ENV.PLATFORM_WEBHOOK_SECRET) => ({
  "x-figbloom-signature": `sha256=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`,
  "x-figbloom-timestamp": ts,
});
const decision = (orgId: string, platformId: string, status: string, reason: string | null = null) => ({
  organization: { id: platformId, local_id: orgId, status, status_reason: reason },
  decided_by: "staff:ops@figbloom.org",
  decided_at: new Date().toISOString(),
});
const link = (orgId: string) => adminDb.platformLink.findUnique({ where: { entityKind_localId: { entityKind: "organization", localId: orgId } } });

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  for (const f of Object.values(platform)) f.mockReset();
  platform.putTenant.mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());

describe("registering organisations with the platform", () => {
  it("sends a new organisation at once: first as a backfill copying its status, then only its name", async () => {
    const org = await createTestOrganization("Acme");
    const platformId = randomUUID();
    platform.putOrganization.mockResolvedValue({ organization_id: platformId, status: "active", status_reason: null });

    await organizationChanged(org.id);
    expect(platform.putOrganization).toHaveBeenLastCalledWith(org.id, expect.objectContaining({ name: org.name, status: "active", backfill: true }));
    expect(platform.putTenant).toHaveBeenLastCalledWith(org.id, expect.objectContaining({ slug: org.slug, organization_local_id: org.id }));
    expect((await link(org.id))?.platformId).toBe(platformId);
    expect(await adminDb.platformSyncQueue.count({ where: { localId: org.id } })).toBe(0);

    await organizationChanged(org.id); // a rename: the platform decides the status from now on
    expect(platform.putOrganization.mock.lastCall![1]).not.toHaveProperty("status");
    expect(platform.putOrganization.mock.lastCall![1]).not.toHaveProperty("backfill");
  });

  it("keeps a change it couldn't send, and the sync sends it later; nothing happens while the link is off", async () => {
    const org = await createTestOrganization("Offline");
    platform.putOrganization.mockRejectedValueOnce(new Error("The platform answered 503."));
    await organizationChanged(org.id); // never throws
    const row = await adminDb.platformSyncQueue.findFirstOrThrow({ where: { localId: org.id } });
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain("503");
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    await adminDb.platformSyncQueue.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    platform.putOrganization.mockResolvedValue({ organization_id: randomUUID(), status: "active", status_reason: null });
    const r = await runPlatformSync();
    expect(r.sent).toBeGreaterThanOrEqual(1);
    expect(await adminDb.platformSyncQueue.count({ where: { localId: org.id } })).toBe(0);

    vi.stubEnv("PLATFORM_LINK_ENABLED", "");
    platform.putOrganization.mockClear();
    await organizationChanged(org.id);
    expect(platform.putOrganization).not.toHaveBeenCalled();
    expect((await runPlatformSync()).skipped).toBe(true);
  });

  it("backs off 1, 2, 4 ... minutes, at most an hour", () => {
    expect([1, 2, 3, 10].map(backoffMs)).toEqual([60_000, 120_000, 240_000, 3_600_000]);
  });
});

describe("the console's decisions", () => {
  async function linkedOrg() {
    const org = await createTestOrganization("Decided");
    const platformId = randomUUID();
    await adminDb.platformLink.create({ data: { entityKind: "organization", localId: org.id, platformId } });
    return { org, platformId };
  }

  it("checks the platform's signature: right secret, unchanged body, within 5 minutes", () => {
    const body = JSON.stringify({ a: 1 });
    const h = sign(body);
    expect(verifyPlatformSignature(ENV.PLATFORM_WEBHOOK_SECRET, body, h["x-figbloom-signature"], h["x-figbloom-timestamp"])).toBe(true);
    expect(verifyPlatformSignature(ENV.PLATFORM_WEBHOOK_SECRET, body + " ", h["x-figbloom-signature"], h["x-figbloom-timestamp"])).toBe(false);
    expect(verifyPlatformSignature("other", body, h["x-figbloom-signature"], h["x-figbloom-timestamp"])).toBe(false);
    const old = sign(body, String(Math.floor(Date.now() / 1000) - 600));
    expect(verifyPlatformSignature(ENV.PLATFORM_WEBHOOK_SECRET, body, old["x-figbloom-signature"], old["x-figbloom-timestamp"])).toBe(false);
  });

  it("suspending pauses the organisation: its members are refused with an explanation, their sessions end, leads keep coming", async () => {
    const { org, platformId } = await linkedOrg();
    const sales = await createTestContext(org.id, "SALES");
    const session = await createSession(sales.userId, { organizationId: org.id });
    const { plaintext, keyHash, keyPrefix } = generateWebsiteApiKey();
    await adminDb.websiteApiKey.create({ data: { organizationId: org.id, keyHash, keyPrefix } });

    expect(await applyPlatformDecision(randomUUID(), decision(org.id, platformId, "suspended", "unpaid"))).toBe("applied");
    expect((await adminDb.organization.findUniqueOrThrow({ where: { id: org.id } })).status).toBe("SUSPENDED");
    expect((await lookupSession(session.token)).state).toBe("revoked");

    const fresh = await createSession(sales.userId, { organizationId: org.id });
    const err = await resolveRequestContext(org.slug, cookieReaderFrom({ [SESSION_COOKIE_NAME]: fresh.token })).catch((e) => e);
    expect(err).toBeInstanceOf(OrganizationSuspendedError);
    expect(err.message).toMatch(/paused\. Contact Figbloom/);
    // website lead capture still works for a suspended organisation (Mike, 2026-11-19)
    await expect(resolveWebsitePublicContext(org.slug, plaintext)).resolves.toBeTruthy();

    const audit = await adminDb.auditEvent.findFirstOrThrow({ where: { organizationId: org.id, action: "organization.suspended" } });
    expect(audit.metadata).toMatchObject({ via: "figbloom-console", reason: "unpaid", decidedBy: "staff:ops@figbloom.org" });

    expect(await applyPlatformDecision(randomUUID(), decision(org.id, platformId, "active"))).toBe("applied");
    expect((await resolveRequestContext(org.slug, cookieReaderFrom({ [SESSION_COOKIE_NAME]: fresh.token }))).organizationId).toBe(org.id);
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "organization.reactivated" } })).toBe(1);
  });

  it("applies a repeated delivery once, and refuses an organisation that isn't CRM's or is linked to another platform ID", async () => {
    const { org, platformId } = await linkedOrg();
    const id = randomUUID();
    expect(await applyPlatformDecision(id, decision(org.id, platformId, "suspended"))).toBe("applied");
    expect(await applyPlatformDecision(id, decision(org.id, platformId, "active"))).toBe("repeated");
    expect((await adminDb.organization.findUniqueOrThrow({ where: { id: org.id } })).status).toBe("SUSPENDED");
    await expect(applyPlatformDecision(randomUUID(), decision(randomUUID(), platformId, "active"))).rejects.toBeInstanceOf(UnknownOrganizationError);
    await expect(applyPlatformDecision(randomUUID(), decision(org.id, randomUUID(), "active"))).rejects.toBeInstanceOf(UnknownOrganizationError);
  });

  it("the webhook route answers 401 to a bad signature and applies a signed decision", async () => {
    const { POST } = await import("../src/app/api/platform/decisions/route");
    const { org, platformId } = await linkedOrg();
    const body = JSON.stringify(decision(org.id, platformId, "suspended", "test"));
    const call = (headers: Record<string, string>) =>
      POST(new Request("https://crm.example.test/api/platform/decisions", { method: "POST", body, headers: { "x-figbloom-delivery": randomUUID(), ...headers } }));

    expect((await call({ "x-figbloom-signature": "sha256=nope", "x-figbloom-timestamp": String(Math.floor(Date.now() / 1000)) })).status).toBe(401);
    const res = await call(sign(body));
    expect(res.status).toBe(200);
    expect((await adminDb.organization.findUniqueOrThrow({ where: { id: org.id } })).status).toBe("SUSPENDED");
  });
});

describe("what the console sees and does", () => {
  it("lets only the console's secret in", () => {
    expect(consoleSecretMatches(ENV.PLATFORM_CONSOLE_SECRET)).toBe(true);
    expect(consoleSecretMatches("wrong")).toBe(false);
    expect(consoleSecretMatches(null)).toBe(false);
    expect(consoleSecretMatches("anything", { PLATFORM_CONSOLE_SECRET: "" })).toBe(false);
  });

  it("summarises an organisation with counts and its admin, and nothing a role would mask", async () => {
    const org = await createTestOrganization("Summary");
    await createTestContext(org.id, "MANAGEMENT");
    await createTestContext(org.id, "SALES");
    const s = await getOrganizationSummary(org.id);
    expect(s).toMatchObject({ id: org.id, slug: org.slug, status: "active", counts: { activeMembers: 2, pendingInvitations: 0, openDeals: 0 } });
    expect(s.admin?.email).toMatch(/@example\.test$/);
    expect(JSON.stringify(s)).not.toMatch(/value|amount|margin|phone/i);
  });

  it("creates an organisation for a customer: defaults, the admin invited as Management, audited with who asked, registered", async () => {
    platform.putOrganization.mockResolvedValue({ organization_id: randomUUID(), status: "active", status_reason: null });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const suffix = randomUUID().slice(0, 8);
    const s = await createOrganizationFromConsole({
      name: `Customer ${suffix}`,
      adminName: "Ada Admin",
      adminEmail: `ada.${suffix}@example.test`,
      staffEmail: "OPS@figbloom.org",
    });
    log.mockRestore();
    expect(s.slug).toBe(`customer-${suffix}`);
    expect(s.counts.pendingInvitations).toBe(1);
    expect(s.admin).toEqual({ name: "Ada Admin", email: `ada.${suffix}@example.test` });
    expect(s.platformOrganizationId).not.toBeNull();
    const audit = await adminDb.auditEvent.findFirstOrThrow({ where: { organizationId: s.id, action: "organization.provisioned" } });
    expect(audit.metadata).toMatchObject({ via: "figbloom-console", by: "ops@figbloom.org" });

    await expect(
      createOrganizationFromConsole({ name: "Again", slug: s.slug, adminName: "B", adminEmail: `b.${suffix}@example.test`, staffEmail: "ops@figbloom.org" }),
    ).rejects.toMatchObject({ status: 409, code: "SLUG_TAKEN" });
    await expect(createOrganizationFromConsole({ name: "X", adminName: "B", adminEmail: "not-an-email", staffEmail: "ops@figbloom.org" })).rejects.toThrow(/email/);
  });

  it("makes addresses from names", () => {
    expect(slugFor("  Acme & Sons Ltd. ")).toBe("acme-sons-ltd");
    expect(slugFor("Café Été")).toBe("cafe-ete");
  });

  it("the console routes: absent while the link is off, 401 without the secret, the list with it", async () => {
    const { GET } = await import("../src/app/api/platform/organizations/route");
    const req = (secret?: string) =>
      new Request("https://crm.example.test/api/platform/organizations", { headers: secret ? { "x-platform-secret": secret } : {} });
    expect((await GET(req(ENV.PLATFORM_CONSOLE_SECRET))).status).toBe(200);
    expect((await GET(req("wrong"))).status).toBe(401);
    vi.stubEnv("PLATFORM_LINK_ENABLED", "");
    expect((await GET(req(ENV.PLATFORM_CONSOLE_SECRET))).status).toBe(404);
  });

  it("is server to server: no CSRF check on the console and webhook routes, still on CRM's own platform routes", () => {
    expect(isCsrfProtectedRequest("POST", "/api/platform/organizations")).toBe(false);
    expect(isCsrfProtectedRequest("POST", "/api/platform/decisions")).toBe(false);
    expect(isCsrfProtectedRequest("POST", "/api/platform/preferences")).toBe(true);
    expect(UnauthorizedError).toBeTruthy();
  });
});
