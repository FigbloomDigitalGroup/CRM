import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationUnavailableError, ValidationError } from "../src/auth/errors";
import { resolveRequestContext } from "../src/auth/requestContext";
import { SESSION_COOKIE_NAME, createSession } from "../src/auth/session";
import { adminDb } from "../src/db/adminClient";
import { getPlatformDb } from "../src/db/platformClient";
import { ORG_EXPORT_JOB } from "../src/jobs/offboardingJobs";
import { enqueueJobFor, runDueJobs, tickSchedules } from "../src/jobs/runner";
import { resolveActiveMembership } from "../src/repositories/memberships";
import { transitionOrganization } from "../src/services/organizationLifecycleService";
import { listAuditEvents } from "../src/services/platformAuditService";
import { getRun } from "../src/services/dataRunService";
import { createTestMembership, createTestOrganization } from "./helpers/fixtures";
import { cookieJar, ctxParams, jsonRequest, makePlatformAdmin, removeTestPlatformAdmins, type TestPlatformAdmin } from "./helpers/platform";
import { discoverRoutes, fillParams, invoke, isOrganisationRoute } from "./helpers/routeHarness";

/**
 * FIG-1137 (B6.05): suspend, reactivate and offboard, enforced everywhere the tenant app serves data.
 */
const holder = vi.hoisted(() => ({ jar: { get: (_name: string): { value: string } | undefined => undefined } }));
vi.mock("next/headers", () => ({ cookies: async () => holder.jar }));

let admin: TestPlatformAdmin;
beforeEach(async () => {
  admin ??= await makePlatformAdmin("lifecycle");
});
afterEach(() => {
  holder.jar = cookieJar({});
});
afterAll(async () => {
  await removeTestPlatformAdmins();
  await getPlatformDb().$disconnect();
});

async function organisationWithManager() {
  const org = await createTestOrganization();
  const { user, membership } = await createTestMembership(org.id, "MANAGEMENT", "lifecycle.mgr");
  const session = await createSession(user.id);
  return { org, user, membership, jar: cookieJar({ [SESSION_COOKIE_NAME]: session.token }) };
}

const move = (id: string, action: "suspend" | "reactivate" | "offboard", reason = "Contract paused for the test") => transitionOrganization(admin.actor, id, action, reason);
const statusOf = async (id: string) => (await adminDb.organization.findUniqueOrThrow({ where: { id } })).status;

describe("the state machine", () => {
  it("allows exactly these moves", async () => {
    const { org } = await organisationWithManager();
    expect(await move(org.id, "suspend")).toMatchObject({ from: "ACTIVE", to: "SUSPENDED" });
    expect(await statusOf(org.id)).toBe("SUSPENDED");
    expect(await move(org.id, "reactivate")).toMatchObject({ from: "SUSPENDED", to: "ACTIVE" });
    expect(await move(org.id, "offboard")).toMatchObject({ from: "ACTIVE", to: "OFFBOARDING" });
    expect(await move(org.id, "reactivate")).toMatchObject({ from: "OFFBOARDING", to: "ACTIVE" });
    await move(org.id, "suspend");
    expect(await move(org.id, "offboard")).toMatchObject({ from: "SUSPENDED", to: "OFFBOARDING" });
  });

  it("refuses every other move, with a plain reason, and changes nothing", async () => {
    const { org } = await organisationWithManager();
    await expect(move(org.id, "reactivate")).rejects.toThrow(/cannot be reactivated|active/i); // already active
    await move(org.id, "suspend");
    await expect(move(org.id, "suspend")).rejects.toThrow(/already suspended/);
    await move(org.id, "offboard");
    await expect(move(org.id, "suspend")).rejects.toThrow(/offboarding cannot be suspended/);
    await expect(move(org.id, "offboard")).rejects.toThrow(/already offboarding/);
    expect(await statusOf(org.id)).toBe("OFFBOARDING");

    const gone = await adminDb.organization.create({ data: { name: "Gone", slug: `gone-${randomUUID().slice(0, 8)}`, status: "OFFBOARDED" } });
    for (const action of ["suspend", "reactivate", "offboard"] as const) {
      await expect(move(gone.id, action), action).rejects.toThrow(/offboarded and its data deleted/);
    }
    await expect(move(randomUUID(), "suspend")).rejects.toThrow(/not found/i);
  });

  it("needs a written reason, and records it three times, in one transaction with the change", async () => {
    const { org } = await organisationWithManager();
    await expect(move(org.id, "suspend", "")).rejects.toThrow(ValidationError);
    await expect(move(org.id, "suspend", "abc")).rejects.toThrow(/at least 5/);
    await expect(move(org.id, "suspend", "x".repeat(501))).rejects.toThrow(/500/);
    expect(await statusOf(org.id)).toBe("ACTIVE");
    expect(await adminDb.organizationLifecycleEvent.count({ where: { organizationId: org.id } })).toBe(0);

    await transitionOrganization(admin.actor, org.id, "suspend", "Unpaid invoice 2026-11", { requestId: "req-lifecycle-1" });
    const trail = await adminDb.organizationLifecycleEvent.findMany({ where: { organizationId: org.id } });
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ fromStatus: "ACTIVE", toStatus: "SUSPENDED", action: "suspend", reason: "Unpaid invoice 2026-11", actorIdentityId: admin.id });

    const platformLog = (await listAuditEvents({ organizationId: org.id })).items;
    expect(platformLog).toHaveLength(1);
    expect(platformLog[0]).toMatchObject({ action: "organization.suspended", actorIdentityId: admin.id, actorLabel: admin.email, reason: "Unpaid invoice 2026-11", requestId: "req-lifecycle-1", metadata: { from: "ACTIVE", to: "SUSPENDED" } });

    // The organisation's own history shows the change, without the reason.
    const own = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: "organization.suspended" } });
    expect(own).toHaveLength(1);
    expect(JSON.stringify(own[0]!.metadata)).not.toMatch(/Unpaid/);
  });

  it("a refused move writes nothing anywhere", async () => {
    const { org } = await organisationWithManager();
    await move(org.id, "suspend");
    const before = (await listAuditEvents({ organizationId: org.id })).items.length;
    await expect(move(org.id, "suspend")).rejects.toThrow();
    expect((await listAuditEvents({ organizationId: org.id })).items).toHaveLength(before);
    expect(await adminDb.organizationLifecycleEvent.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it("two admins moving the same organisation at once: one wins, the other is refused", async () => {
    const { org } = await organisationWithManager();
    const results = await Promise.allSettled([move(org.id, "suspend"), move(org.id, "suspend")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await adminDb.organizationLifecycleEvent.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it("a deletion that has been approved blocks reactivation until that request is cancelled", async () => {
    const { org } = await organisationWithManager();
    await move(org.id, "offboard");
    await adminDb.platformDataRequest.create({
      data: { organizationId: org.id, organizationSlug: org.slug, organizationName: org.name, kind: "DELETE", status: "APPROVED", approvalsRequired: 2 },
    });
    await expect(move(org.id, "reactivate")).rejects.toThrow(/deletion has been approved/);
    expect(await statusOf(org.id)).toBe("OFFBOARDING");
  });
});

describe("enforcement in the tenant app", () => {
  it("a suspended organisation serves nothing: the request context refuses, and says which state", async () => {
    const { org, jar } = await organisationWithManager();
    expect((await resolveRequestContext(org.slug, jar)).organizationId).toBe(org.id);

    await move(org.id, "suspend");
    await expect(resolveRequestContext(org.slug, jar)).rejects.toBeInstanceOf(OrganizationUnavailableError);
    await expect(resolveRequestContext(org.slug, jar)).rejects.toMatchObject({ state: "SUSPENDED", organizationName: org.name });
    await expect(resolveRequestContext(org.slug, jar, { allowOffboarding: true })).rejects.toMatchObject({ state: "SUSPENDED" });
  });

  // Walks every organisation route (hundreds, and more with each issue), so it gets a generous time limit.
  it("every organisation API route answers the suspended notice, whoever asks and whatever they ask", { timeout: 180_000 }, async () => {
    const { org, jar } = await organisationWithManager();
    await move(org.id, "suspend");
    holder.jar = jar;
    const routes = discoverRoutes().filter(isOrganisationRoute);
    expect(routes.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const route of routes) {
      for (const method of route.methods) {
        const result = await invoke(route, method, fillParams(route, org.slug));
        const ok = result.status === 403 && result.json?.organization?.state === "SUSPENDED" && result.json?.code === "FORBIDDEN";
        if (!ok) offenders.push(`${method} ${route.path} -> ${result.status}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reactivation restores access for the same session, and other organisations were never affected", async () => {
    const a = await organisationWithManager();
    const b = await organisationWithManager();
    await move(a.org.id, "suspend");
    holder.jar = a.jar;
    const leads = discoverRoutes().find((r) => r.path === "/api/orgs/{orgSlug}/leads")!;
    expect((await invoke(leads, "GET", fillParams(leads, a.org.slug))).status).toBe(403);
    holder.jar = b.jar;
    expect((await invoke(leads, "GET", fillParams(leads, b.org.slug))).status).toBe(200);

    await move(a.org.id, "reactivate");
    holder.jar = a.jar;
    expect((await invoke(leads, "GET", fillParams(leads, a.org.slug))).status).toBe(200);
  });

  it("a person in two organisations is blocked in the suspended one only", async () => {
    const a = await organisationWithManager();
    const b = await createTestOrganization();
    const role = await adminDb.role.findUniqueOrThrow({ where: { key: "SALES" } });
    await adminDb.membership.create({ data: { organizationId: b.id, userId: a.user.id, roleId: role.id, joinedAt: new Date() } });
    await move(a.org.id, "suspend");
    await expect(resolveActiveMembership(a.user.id, a.org.id)).rejects.toBeInstanceOf(OrganizationUnavailableError);
    expect((await resolveActiveMembership(a.user.id, b.id))?.organizationId).toBe(b.id);
  });

  it("offboarding blocks the app too, except the data-request routes the organisation needs to follow its export", async () => {
    const { org, jar } = await organisationWithManager();
    await move(org.id, "offboard");
    holder.jar = jar;
    const leads = discoverRoutes().find((r) => r.path === "/api/orgs/{orgSlug}/leads")!;
    const blocked = await invoke(leads, "GET", fillParams(leads, org.slug));
    expect(blocked.status).toBe(403);
    expect(blocked.json.organization).toMatchObject({ state: "OFFBOARDING" });

    const requests = discoverRoutes().find((r) => r.path === "/api/orgs/{orgSlug}/privacy/organisation-requests")!;
    expect((await invoke(requests, "GET", fillParams(requests, org.slug))).status).toBe(200);
    const download = discoverRoutes().find((r) => r.path === "/api/orgs/{orgSlug}/privacy/organisation-requests/{requestId}/download")!;
    expect((await invoke(download, "GET", fillParams(download, org.slug))).status).toBe(404); // reachable; there is simply no such request
  });

  it("an offboarded organisation serves nothing at all", async () => {
    const { org, jar } = await organisationWithManager();
    await adminDb.organization.update({ where: { id: org.id }, data: { status: "OFFBOARDED" } });
    await expect(resolveRequestContext(org.slug, jar, { allowOffboarding: true })).rejects.toMatchObject({ state: "OFFBOARDED" });
  });

  it("public keys of a suspended organisation stop working too (the website form), and work again after reactivation", async () => {
    const { org } = await organisationWithManager();
    const { generateWebsiteApiKey, resolveWebsitePublicContext } = await import("../src/auth/websiteApiKey");
    const key = generateWebsiteApiKey();
    await adminDb.websiteApiKey.create({ data: { organizationId: org.id, keyHash: key.keyHash, keyPrefix: key.keyPrefix } });
    expect((await resolveWebsitePublicContext(org.slug, key.plaintext)).organizationId).toBe(org.id);
    await move(org.id, "suspend");
    await expect(resolveWebsitePublicContext(org.slug, key.plaintext)).rejects.toThrow(/Invalid or missing API key/);
    await move(org.id, "reactivate");
    expect((await resolveWebsitePublicContext(org.slug, key.plaintext)).organizationId).toBe(org.id);
  });
});

describe("enforcement in jobs", () => {
  async function queued(orgId: string, type: string) {
    return enqueueJobFor({ organizationId: orgId, type });
  }
  const status = async (id: string) => (await adminDb.backgroundJob.findUniqueOrThrow({ where: { id } })).status;

  it("a suspended organisation's jobs wait, and run when it is reactivated", async () => {
    const { org } = await organisationWithManager();
    const job = await queued(org.id, "notifications.expire");
    await move(org.id, "suspend");

    const during = await runDueJobs({ organizationIds: [org.id], maxJobs: 5 });
    expect(during.results).toEqual([]);
    expect(await status(job.id)).toBe("QUEUED");

    await move(org.id, "reactivate");
    const after = await runDueJobs({ organizationIds: [org.id], maxJobs: 5 });
    expect(after.results.map((r) => r.jobId)).toContain(job.id);
    expect(await status(job.id)).toBe("SUCCEEDED");
  });

  it("scheduled work is not queued for a suspended, offboarding or offboarded organisation", async () => {
    const { org } = await organisationWithManager();
    await move(org.id, "suspend");
    expect((await tickSchedules({ organizationIds: [org.id] })).enqueued).toBe(0);
    await move(org.id, "offboard");
    expect((await tickSchedules({ organizationIds: [org.id] })).enqueued).toBe(0);
    expect(await adminDb.backgroundJob.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it("while offboarding only the export job runs", async () => {
    const { org } = await organisationWithManager();
    const other = await queued(org.id, "notifications.expire");
    const exportJob = await enqueueJobFor({ organizationId: org.id, type: ORG_EXPORT_JOB, payload: { requestId: randomUUID() } });
    await move(org.id, "offboard");

    const result = await runDueJobs({ organizationIds: [org.id], maxJobs: 5 });
    expect(result.results.map((r) => r.jobId)).toEqual([exportJob.id]);
    expect(await status(other.id)).toBe("QUEUED");
    expect(await status(exportJob.id)).toBe("SUCCEEDED"); // no such request: the handler skips it
  });

  it("an organisation that is not suspended is not held up by one that is", async () => {
    const a = await organisationWithManager();
    const b = await organisationWithManager();
    const ja = await queued(a.org.id, "notifications.expire");
    const jb = await queued(b.org.id, "notifications.expire");
    await move(a.org.id, "suspend");
    const result = await runDueJobs({ organizationIds: [a.org.id, b.org.id], maxJobs: 5 });
    expect(result.results.map((r) => r.jobId)).toEqual([jb.id]);
    expect(await status(ja.id)).toBe("QUEUED");
    expect(getRun).toBeDefined();
  });
});

describe("the platform route", () => {
  it("moves the state with the key, refuses a bad body and a bad move, and gives tenants a 404", async () => {
    const route = await import("../src/app/api/platform/organizations/[organizationId]/status/route");
    const { org, jar } = await organisationWithManager();
    holder.jar = admin.jar;
    const post = (body: unknown, id = org.id) => route.POST(jsonRequest("/api/platform/x", "POST", body), ctxParams({ organizationId: id }));

    expect((await post({ action: "suspend", reason: "no" })).status).toBe(400);
    expect((await post({ action: "delete", reason: "A good reason" })).status).toBe(400);
    expect((await post({ action: "suspend", reason: "A good reason", extra: 1 })).status).toBe(400);
    const ok = await post({ action: "suspend", reason: "A good reason" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ from: "ACTIVE", to: "SUSPENDED", slug: org.slug });
    const again = await post({ action: "suspend", reason: "A good reason" });
    expect(again.status).toBe(400);
    expect((await again.json()).fieldErrors[0]).toMatchObject({ code: "INVALID_TRANSITION" });
    expect((await post({ action: "reactivate", reason: "A good reason" }, randomUUID())).status).toBe(404);

    holder.jar = jar; // a Management user of that organisation
    expect((await post({ action: "reactivate", reason: "I would like in" })).status).toBe(404);
    expect(await statusOf(org.id)).toBe("SUSPENDED");
  });
});
