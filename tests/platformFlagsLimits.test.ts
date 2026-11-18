import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { getPlatformDb } from "../src/db/platformClient";
import { buildErrorResponse } from "../src/lib/apiErrors";
import { isFeatureEnabled, setOrganizationRelease, updateFeatureToggles } from "../src/services/featureService";
import { createUpload } from "../src/services/fileService";
import { deactivateMember, inviteMember, reactivateMember } from "../src/services/membershipService";
import { LimitReachedError, getUsage, recordApiCall, usagePeriodStart } from "../src/services/orgLimitService";
import { listAuditEvents } from "../src/services/platformAuditService";
import { getOrganizationFlags, updateOrganizationFlags } from "../src/services/platformFlagsService";
import { LocalDriver } from "../src/storage/localDriver";
import { setStorageDriverForTests } from "../src/storage";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";
import { cookieJar, ctxParams, jsonRequest, makePlatformAdmin, removeTestPlatformAdmins, type TestPlatformAdmin } from "./helpers/platform";

/**
 * FIG-1184 (B7.02): flags and limits per organisation. Platform overrides of the organisation's toggles, limits on seats, storage and
 * API calls, enforcement with friendly messages, usage counts without business data, and an audit entry for every change.
 */
const holder = vi.hoisted(() => ({ jar: { get: (_name: string): { value: string } | undefined => undefined } }));
vi.mock("next/headers", () => ({ cookies: async () => holder.jar }));

import * as flagsRoute from "../src/app/api/platform/organizations/[organizationId]/flags/route";

let admin: TestPlatformAdmin;
let dir: string;
const previousRelease = process.env.ACTIVE_RELEASE;

beforeAll(async () => {
  process.env.ACTIVE_RELEASE = "v2";
  process.env.STORAGE_SIGNING_SECRET = "limits-test-secret-limits-test-secret";
  dir = await mkdtemp(join(tmpdir(), "figbloom-limits-"));
  setStorageDriverForTests(new LocalDriver({ rootDir: dir, signingSecret: process.env.STORAGE_SIGNING_SECRET, baseUrl: "http://localhost:3000" }));
  admin = await makePlatformAdmin("flags-admin");
});
afterAll(async () => {
  if (previousRelease === undefined) delete process.env.ACTIVE_RELEASE;
  else process.env.ACTIVE_RELEASE = previousRelease;
  setStorageDriverForTests(null);
  await rm(dir, { recursive: true, force: true });
  await removeTestPlatformAdmins();
  await getPlatformDb().$disconnect();
});
beforeEach(() => {
  holder.jar = admin.jar;
});
afterEach(() => {
  holder.jar = cookieJar({});
});

async function setup(release: "v1" | "v1.1" | "v2" = "v2") {
  const org = await createTestOrganization("Limits org");
  await setOrganizationRelease(org.id, release);
  const mgmt = await createTestContext(org.id, "MANAGEMENT", "lim.mgmt");
  return { org, mgmt };
}

const REASON = "Pilot agreement signed with the customer";
const invite = (ctx: Awaited<ReturnType<typeof setup>>["mgmt"], email: string) => inviteMember(ctx, { email, name: "New Person", roleKey: "SALES" }, (t) => `http://localhost/accept/${t}`);

describe("platform flag overrides", () => {
  it("fixes a toggle for the organisation and takes the choice away from the organisation", async () => {
    const { org, mgmt } = await setup("v2");
    expect(await isFeatureEnabled(org.id, "assistant.enabled")).toBe(false);
    await updateOrganizationFlags(admin.actor, org.id, { flags: { "assistant.enabled": true }, reason: REASON });
    expect(await isFeatureEnabled(org.id, "assistant.enabled")).toBe(true);

    await expect(updateFeatureToggles(mgmt, { "assistant.enabled": false })).rejects.toMatchObject({
      name: "ValidationError",
      message: expect.stringContaining("managed by Figbloom"),
    });
    // Other toggles stay the organisation's own.
    await expect(updateFeatureToggles(mgmt, { "personalisation.allowed": false })).resolves.toBeTruthy();

    await updateOrganizationFlags(admin.actor, org.id, { flags: { "assistant.enabled": null }, reason: REASON });
    await updateFeatureToggles(mgmt, { "assistant.enabled": false });
    expect(await isFeatureEnabled(org.id, "assistant.enabled")).toBe(false);
  });

  it("can switch a feature off that the organisation had on, and never beats the release", async () => {
    const { org } = await setup("v1.1");
    expect(await isFeatureEnabled(org.id, "quotes.enabled")).toBe(true);
    await updateOrganizationFlags(admin.actor, org.id, { flags: { "quotes.enabled": false }, reason: REASON });
    expect(await isFeatureEnabled(org.id, "quotes.enabled")).toBe(false);

    const v1 = await setup("v1");
    await updateOrganizationFlags(admin.actor, v1.org.id, { flags: { "assistant.enabled": true }, reason: REASON });
    // assistant.enabled arrives in V1.1: an override cannot pull it into a V1 organisation.
    expect(await isFeatureEnabled(v1.org.id, "assistant.enabled")).toBe(false);
    const view = await getOrganizationFlags(v1.org.id);
    expect(view.flags.find((f) => f.key === "assistant.enabled")).toMatchObject({ platformValue: true, available: false, effective: false });
  });

  it("is per organisation: another organisation is untouched", async () => {
    const a = await setup("v1.1");
    const b = await setup("v1.1");
    await updateOrganizationFlags(admin.actor, a.org.id, { flags: { "quotes.enabled": false }, limits: { seats: 3 }, reason: REASON });
    expect(await isFeatureEnabled(b.org.id, "quotes.enabled")).toBe(true);
    expect((await getOrganizationFlags(b.org.id)).limits.seats).toBeNull();
  });

  it("refuses unknown flags, bad limits, a missing reason and an empty change", async () => {
    const { org } = await setup();
    await expect(updateOrganizationFlags(admin.actor, org.id, { flags: { "no.such.flag": true }, reason: REASON })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateOrganizationFlags(admin.actor, org.id, { limits: { seats: 0 }, reason: REASON })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateOrganizationFlags(admin.actor, org.id, { limits: { seats: 2.5 }, reason: REASON })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateOrganizationFlags(admin.actor, org.id, { limits: { nonsense: 5 }, reason: REASON })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateOrganizationFlags(admin.actor, org.id, { limits: { seats: 5 }, reason: "no" })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateOrganizationFlags(admin.actor, org.id, { reason: REASON })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateOrganizationFlags(admin.actor, "00000000-0000-0000-0000-000000000000", { limits: { seats: 5 }, reason: REASON })).rejects.toMatchObject({ name: "NotFoundError" });
  });
});

describe("audit", () => {
  it("writes one platform audit entry per change with the reason, and one line in the organisation's own history", async () => {
    const { org } = await setup("v1.1");
    await updateOrganizationFlags(admin.actor, org.id, { flags: { "quotes.enabled": false }, limits: { seats: 8, storageMb: 500 }, reason: REASON });
    const flagEvents = await listAuditEvents({ organizationId: org.id, action: "organization.flags.changed" });
    expect(flagEvents.items).toHaveLength(1);
    expect(flagEvents.items[0]).toMatchObject({ actorLabel: admin.email, reason: REASON, metadata: { key: "quotes.enabled", from: null, to: false } });
    const limitEvents = await listAuditEvents({ organizationId: org.id, action: "organization.limits.changed" });
    expect(limitEvents.items.map((e) => e.metadata.key).sort()).toEqual(["seats", "storageMb"]);

    // Setting the same values again changes nothing and writes nothing.
    await updateOrganizationFlags(admin.actor, org.id, { flags: { "quotes.enabled": false }, limits: { seats: 8 }, reason: REASON });
    expect((await listAuditEvents({ organizationId: org.id, action: "organization.limits.changed" })).items).toHaveLength(2);

    const own = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: { in: ["platform_flag.changed", "platform_limit.changed"] } } });
    expect(own).toHaveLength(3);
    expect(JSON.stringify(own)).not.toContain(REASON);

    const view = await getOrganizationFlags(org.id);
    expect(view.history.map((h) => h.key).sort()).toEqual(["quotes.enabled", "seats", "storageMb"]);
    expect(view.history[0]!.reason).toBe(REASON);
  });
});

describe("seats", () => {
  it("refuses a new invitation and a reactivation at the limit, with a friendly message, and counts pending invitations", async () => {
    const { org, mgmt } = await setup();
    const member = await createTestContext(org.id, "SALES", "lim.sales");
    // Two active members. A limit of 3 leaves one seat.
    await updateOrganizationFlags(admin.actor, org.id, { limits: { seats: 3 }, reason: REASON });
    await invite(mgmt, `seat.one.${org.slug}@example.com`);
    const full = await invite(mgmt, `seat.two.${org.slug}@example.com`).catch((e: unknown) => e);
    expect(full).toBeInstanceOf(LimitReachedError);
    expect((full as LimitReachedError).message).toBe("Your organisation is using all 3 of its seats. Deactivate a member you no longer need, or ask Figbloom to add seats.");
    expect((await buildErrorResponse(full, "req-1")).status).toBe(403);

    // Sending the same pending invitation again does not take another seat.
    await expect(invite(mgmt, `seat.one.${org.slug}@example.com`)).resolves.toBeTruthy();

    // A deactivated member frees a seat; reactivating them when the seats are full is refused.
    await deactivateMember(mgmt, member.membershipId);
    await expect(invite(mgmt, `seat.two.${org.slug}@example.com`)).resolves.toBeTruthy();
    await expect(reactivateMember(mgmt, member.membershipId)).rejects.toBeInstanceOf(LimitReachedError);

    const { usage } = await getUsage(org.id);
    expect(usage.seats).toEqual({ limit: 3, used: 3, atLimit: true });
  });

  it("a limit set below the current use removes no one and only stops more being added", async () => {
    const { org, mgmt } = await setup();
    await createTestContext(org.id, "SALES", "lim.s1");
    await createTestContext(org.id, "SALES", "lim.s2");
    await updateOrganizationFlags(admin.actor, org.id, { limits: { seats: 1 }, reason: REASON });
    expect((await getUsage(org.id)).usage.seats).toMatchObject({ limit: 1, used: 3, atLimit: true });
    await expect(invite(mgmt, `over.${org.slug}@example.com`)).rejects.toBeInstanceOf(LimitReachedError);
    await updateOrganizationFlags(admin.actor, org.id, { limits: { seats: null }, reason: REASON });
    await expect(invite(mgmt, `over.${org.slug}@example.com`)).resolves.toBeTruthy();
  });
});

describe("storage", () => {
  const upload = (ctx: Awaited<ReturnType<typeof setup>>["mgmt"], sizeBytes: number) =>
    createUpload(ctx, { purpose: "ATTACHMENT", name: "doc.png", mimeType: "image/png", sizeBytes });

  it("refuses an upload that would pass the limit and says what to do", async () => {
    const { org, mgmt } = await setup();
    await updateOrganizationFlags(admin.actor, org.id, { limits: { storageMb: 1 }, reason: REASON });
    await upload(mgmt, 600 * 1024);
    const refused = await upload(mgmt, 600 * 1024).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(LimitReachedError);
    expect((refused as LimitReachedError).message).toBe("Your organisation has reached its 1 MB storage limit. Delete files you no longer need, or ask Figbloom to raise the limit.");
    await expect(upload(mgmt, 300 * 1024)).resolves.toBeTruthy();
    expect((await getUsage(org.id)).usage.storageMb).toMatchObject({ limit: 1, used: 1, atLimit: true });
  });

  it("does not count another organisation's files", async () => {
    const a = await setup();
    const b = await setup();
    await upload(b.mgmt, 900 * 1024);
    await updateOrganizationFlags(admin.actor, a.org.id, { limits: { storageMb: 1 }, reason: REASON });
    await expect(upload(a.mgmt, 900 * 1024)).resolves.toBeTruthy();
  });
});

describe("API calls", () => {
  it("counts every call, refuses past the monthly limit with 429, and never lets two simultaneous calls both take the last one", async () => {
    const { org } = await setup();
    await updateOrganizationFlags(admin.actor, org.id, { limits: { apiCallsPerMonth: 5 }, reason: REASON });
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => recordApiCall(org.id)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    const refused = results.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
    expect(refused.reason).toBeInstanceOf(LimitReachedError);
    expect((await buildErrorResponse(refused.reason, "req-2")).status).toBe(429);
    expect(refused.reason.message).toContain("used all 5 API calls for this month");
    expect((await getUsage(org.id)).usage.apiCallsPerMonth).toMatchObject({ limit: 5, used: 5, atLimit: true });
  });

  it("counts a new month from zero and counts without a limit", async () => {
    const { org } = await setup();
    await recordApiCall(org.id, new Date("2026-10-31T23:59:00Z"));
    await recordApiCall(org.id, new Date("2026-10-31T23:59:30Z"));
    await recordApiCall(org.id, new Date("2026-11-01T00:00:10Z"));
    expect((await getUsage(org.id, new Date("2026-10-31T12:00:00Z"))).usage.apiCallsPerMonth.used).toBe(2);
    expect((await getUsage(org.id, new Date("2026-11-02T12:00:00Z"))).usage.apiCallsPerMonth.used).toBe(1);
    expect(usagePeriodStart(new Date("2026-11-15T10:00:00Z")).toISOString().slice(0, 10)).toBe("2026-11-01");
  });
});

describe("what the console sees: numbers and switches only", () => {
  it("returns counts, flags and limits and nothing of the organisation's records", async () => {
    const { org } = await setup("v1.1");
    await adminDb.company.create({ data: { organizationId: org.id, name: "Secret Customer Ltd" } });
    await updateOrganizationFlags(admin.actor, org.id, { limits: { seats: 10 }, reason: REASON });
    const view = await getOrganizationFlags(org.id);
    expect(JSON.stringify(view)).not.toContain("Secret Customer");
    expect(Object.keys(view).sort()).toEqual(["flags", "history", "limits", "organization", "release", "releaseLabel", "usage"]);
    expect(Object.keys(view.usage).sort()).toEqual(["apiCallsPerMonth", "seats", "storageMb"]);
  });
});

describe("the route", () => {
  const url = (id: string) => `/api/platform/organizations/${id}/flags`;

  it("answers 404 to anyone who is not a platform admin and below V2, and 403 without a fresh second step", async () => {
    const { org, mgmt } = await setup();
    void mgmt;
    holder.jar = cookieJar({});
    expect((await flagsRoute.GET(jsonRequest(url(org.id), "GET"), ctxParams({ organizationId: org.id }))).status).toBe(404);

    holder.jar = admin.jar;
    expect((await flagsRoute.GET(jsonRequest(url(org.id), "GET"), ctxParams({ organizationId: org.id }))).status).toBe(200);

    process.env.ACTIVE_RELEASE = "v1.1";
    expect((await flagsRoute.GET(jsonRequest(url(org.id), "GET"), ctxParams({ organizationId: org.id }))).status).toBe(404);
    process.env.ACTIVE_RELEASE = "v2";

    // A session whose second step was proved long ago must verify again before changing anything.
    const stale = await makePlatformAdmin("flags-stale");
    await getPlatformDb().platformSession.updateMany({ where: { platformIdentityId: stale.id }, data: { verifiedAt: new Date(Date.now() - 24 * 3_600_000) } });
    holder.jar = stale.jar;
    const refused = await flagsRoute.PATCH(jsonRequest(url(org.id), "PATCH", { limits: { seats: 5 }, reason: REASON }), ctxParams({ organizationId: org.id }));
    expect(refused.status).toBe(403);
    expect((await refused.json()).message).toContain("Verify it's you");

    holder.jar = admin.jar;
    const ok = await flagsRoute.PATCH(jsonRequest(url(org.id), "PATCH", { limits: { seats: 5 }, reason: REASON }), ctxParams({ organizationId: org.id }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).limits.seats).toBe(5);
    const bad = await flagsRoute.PATCH(jsonRequest(url(org.id), "PATCH", { limits: { seats: 5 } }), ctxParams({ organizationId: org.id }));
    expect(bad.status).toBe(400);
  });
});
