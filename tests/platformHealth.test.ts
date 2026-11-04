import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { getPlatformDb } from "../src/db/platformClient";
import { setStorageDriverForTests } from "../src/storage";
import type { StorageDriver } from "../src/storage/types";
import { listAuditEvents } from "../src/services/platformAuditService";
import {
  HEALTH_COMPONENTS,
  checkSystemHealth,
  createIncident,
  getPlatformHome,
  listIncidents,
  resolveIncident,
  worst,
  type Probe,
} from "../src/services/platformHealthService";
import { createCompany } from "../src/repositories/companies";
import { createTestMembership, createTestOrganization } from "./helpers/fixtures";
import { cookieJar, ctxParams, jsonRequest, makePlatformAdmin, removeTestPlatformAdmins, type TestPlatformAdmin } from "./helpers/platform";
import { SESSION_COOKIE_NAME, createSession } from "../src/auth/session";

/**
 * FIG-1139 (B6.07): the health aggregator and the platform home numbers, with injected failures.
 */
const holder = vi.hoisted(() => ({ jar: { get: (_name: string): { value: string } | undefined => undefined } }));
vi.mock("next/headers", () => ({ cookies: async () => holder.jar }));

let admin: TestPlatformAdmin;
beforeEach(async () => {
  admin ??= await makePlatformAdmin("health");
  holder.jar = admin.jar;
});
afterEach(() => {
  holder.jar = cookieJar({});
  setStorageDriverForTests(null);
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await removeTestPlatformAdmins();
  await getPlatformDb().$disconnect();
});

const ok: Probe = async () => ({ status: "OPERATIONAL", detail: "fine", metrics: {} });
const allOk = Object.fromEntries(HEALTH_COMPONENTS.map((c) => [c, ok])) as Record<(typeof HEALTH_COMPONENTS)[number], Probe>;
const byName = (components: { component: string }[], name: string) => components.find((c) => c.component === name) as { component: string; status: string; detail: string; metrics: Record<string, unknown>; latencyMs: number | null };

describe("the real probes", () => {
  it("report all five components, and the API, database and storage really answer", async () => {
    vi.stubEnv("SMTP_HOST", "smtp.test.invalid");
    const health = await checkSystemHealth();
    expect(health.components.map((c) => c.component)).toEqual([...HEALTH_COMPONENTS]);
    expect(byName(health.components, "API")).toMatchObject({ status: "OPERATIONAL" });
    expect(byName(health.components, "DATABASE")).toMatchObject({ status: "OPERATIONAL" });
    expect(byName(health.components, "STORAGE")).toMatchObject({ status: "OPERATIONAL" });
    expect(byName(health.components, "DATABASE").latencyMs).toBeGreaterThanOrEqual(0);
    expect(byName(health.components, "JOBS").metrics).toEqual(expect.objectContaining({ queued: expect.any(Number), dead: expect.any(Number) }));
    expect(["OPERATIONAL", "DEGRADED", "DOWN"]).toContain(health.overall);
    expect(health.checkedAt).toBeTruthy();
  });

  it("the email probe says so when no provider is configured", async () => {
    vi.stubEnv("SMTP_HOST", "");
    const email = byName((await checkSystemHealth({ probes: { API: ok, DATABASE: ok, JOBS: ok, STORAGE: ok } })).components, "EMAIL");
    expect(email).toMatchObject({ status: "DEGRADED" });
    expect(email.detail).toMatch(/No email provider/);
    expect(email.metrics.providerConfigured).toBe(false);
  });

  it("the email probe reflects real delivery failures", async () => {
    vi.stubEnv("SMTP_HOST", "smtp.test.invalid");
    const org = await createTestOrganization();
    const before = byName((await checkSystemHealth({ probes: { API: ok, DATABASE: ok, JOBS: ok, STORAGE: ok } })).components, "EMAIL").metrics.failed24h as number;
    await adminDb.notificationDelivery.createMany({
      data: Array.from({ length: 3 }, () => ({ organizationId: org.id, channel: "EMAIL" as const, recipientEmail: "x@example.test", templateKey: "t", status: "EXHAUSTED" as const })),
    });
    const email = byName((await checkSystemHealth({ probes: { API: ok, DATABASE: ok, JOBS: ok, STORAGE: ok } })).components, "EMAIL");
    expect(email.metrics.failed24h as number).toBeGreaterThanOrEqual(before + 3);
    expect(email.status).not.toBe("OPERATIONAL");
  });

  it("the jobs probe reflects the dead-letter list, and jobs nobody is picking up", async () => {
    // A suspended organisation's jobs are never claimed, so these rows stay exactly as made while the test looks at them.
    const org = await adminDb.organization.create({ data: { name: "Health jobs", slug: `health-jobs-${randomUUID().slice(0, 8)}`, status: "SUSPENDED" } });
    const before = byName((await checkSystemHealth({ probes: { API: ok, DATABASE: ok, EMAIL: ok, STORAGE: ok } })).components, "JOBS").metrics;

    await adminDb.backgroundJob.create({ data: { organizationId: org.id, type: "health.test", status: "DEAD", maxAttempts: 1 } });
    const dead = byName((await checkSystemHealth({ probes: { API: ok, DATABASE: ok, EMAIL: ok, STORAGE: ok } })).components, "JOBS");
    expect(dead.metrics.dead as number).toBeGreaterThanOrEqual((before.dead as number) + 1);
    expect(dead.status).not.toBe("OPERATIONAL");
    // (Other tests leave jobs waiting in the shared database, so the wording may name the worse problem.)
    expect(dead.detail).toMatch(/dead-letter|not being picked up|running late/);

    const stuck = await adminDb.backgroundJob.create({ data: { organizationId: org.id, type: "health.test", runAt: new Date(Date.now() - 3 * 3_600_000) } });
    const down = byName((await checkSystemHealth({ probes: { API: ok, DATABASE: ok, EMAIL: ok, STORAGE: ok } })).components, "JOBS");
    expect(down).toMatchObject({ status: "DOWN" });
    expect(down.detail).toMatch(/not being picked up/);
    await adminDb.backgroundJob.delete({ where: { id: stuck.id } });
    await adminDb.backgroundJob.deleteMany({ where: { organizationId: org.id } });
  });
});

describe("injected failures", () => {
  it("one failing component is reported as such and never hides the others", async () => {
    const boom: Probe = async () => {
      throw new Error("connection refused");
    };
    const health = await checkSystemHealth({ probes: { ...allOk, DATABASE: boom } });
    expect(byName(health.components, "DATABASE")).toMatchObject({ status: "DOWN" });
    expect(byName(health.components, "DATABASE").detail).toMatch(/database check failed: connection refused/);
    for (const name of ["API", "JOBS", "EMAIL", "STORAGE"]) expect(byName(health.components, name).status, name).toBe("OPERATIONAL");
    expect(health.overall).toBe("DOWN");
  });

  it("a probe that never answers is cut off at the time limit", async () => {
    const hang: Probe = () => new Promise(() => undefined);
    const started = Date.now();
    const health = await checkSystemHealth({ probes: { ...allOk, JOBS: hang }, timeoutMs: 60 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(byName(health.components, "JOBS")).toMatchObject({ status: "DOWN" });
    expect(byName(health.components, "JOBS").detail).toMatch(/no answer within 60 ms/);
    expect(byName(health.components, "API").status).toBe("OPERATIONAL");
  });

  it("the overall state is the worst component", async () => {
    const degraded: Probe = async () => ({ status: "DEGRADED", detail: "slow", metrics: {} });
    expect((await checkSystemHealth({ probes: allOk })).overall).toBe("OPERATIONAL");
    expect((await checkSystemHealth({ probes: { ...allOk, EMAIL: degraded } })).overall).toBe("DEGRADED");
    expect(worst(["OPERATIONAL", "DEGRADED", "DOWN"])).toBe("DOWN");
    expect(worst([])).toBe("OPERATIONAL");
  });

  it("storage that cannot write, or returns other bytes, is DOWN", async () => {
    const make = (over: Partial<StorageDriver>): StorageDriver => ({
      name: "local",
      putObject: async () => undefined,
      getObject: async () => Buffer.from("figbloom-health-probe"),
      headObject: async () => null,
      deleteObject: async () => undefined,
      signUpload: async () => {
        throw new Error("unused");
      },
      signDownload: async () => {
        throw new Error("unused");
      },
      ...over,
    });
    const others = { API: ok, DATABASE: ok, JOBS: ok, EMAIL: ok };

    setStorageDriverForTests(make({ putObject: async () => { throw new Error("disk full"); } }));
    expect(byName((await checkSystemHealth({ probes: others })).components, "STORAGE")).toMatchObject({ status: "DOWN" });
    expect(byName((await checkSystemHealth({ probes: others })).components, "STORAGE").detail).toMatch(/disk full/);

    setStorageDriverForTests(make({ getObject: async () => Buffer.from("something else") }));
    expect(byName((await checkSystemHealth({ probes: others })).components, "STORAGE").detail).toMatch(/different bytes/);

    setStorageDriverForTests(make({}));
    expect(byName((await checkSystemHealth({ probes: others })).components, "STORAGE").status).toBe("OPERATIONAL");
  });

  it("the home page shows the failure too", async () => {
    const boom: Probe = async () => {
      throw new Error("db unreachable");
    };
    const home = await getPlatformHome({ probes: { ...allOk, DATABASE: boom } });
    expect(home.health.overall).toBe("DOWN");
    expect(home.health.components.find((c) => c.component === "DATABASE")!.status).toBe("DOWN");
  });
});

describe("incident markers", () => {
  it("open, show on the health page, resolve, and leave an audit trail", async () => {
    const incident = await createIncident(admin.actor, { component: "EMAIL", severity: "DEGRADED", title: "Provider delays", note: "Retrying" }, "req-incident-1");
    expect(incident).toMatchObject({ component: "EMAIL", severity: "DEGRADED", title: "Provider delays", open: true, resolvedAt: null });
    expect((await checkSystemHealth({ probes: allOk })).openIncidents.map((i) => i.id)).toContain(incident.id);

    const resolved = await resolveIncident(admin.actor, incident.id, "req-incident-2");
    expect(resolved).toMatchObject({ open: false });
    expect(resolved.resolvedAt).toBeTruthy();
    expect((await checkSystemHealth({ probes: allOk })).openIncidents.map((i) => i.id)).not.toContain(incident.id);
    expect((await listIncidents()).map((i) => i.id)).toContain(incident.id);
    expect((await resolveIncident(admin.actor, incident.id)).resolvedAt).toBe(resolved.resolvedAt); // resolving again changes nothing

    const trail = (await listAuditEvents({ action: "incident" })).items.filter((e) => e.targetId === incident.id).map((e) => e.action).sort();
    expect(trail).toEqual(["incident.opened", "incident.resolved"]);
    await expect(resolveIncident(admin.actor, randomUUID())).rejects.toThrow(/not found/i);
  });

  it("validate the component, severity and title", async () => {
    await expect(createIncident(admin.actor, { component: "COFFEE", severity: "OUTAGE", title: "x" })).rejects.toThrow(/Use one of API/);
    await expect(createIncident(admin.actor, { component: "API", severity: "LOUD", title: "Fine title" })).rejects.toThrow(/severity|Use one of/);
    await expect(createIncident(admin.actor, { component: "API", severity: "INFO", title: "" })).rejects.toThrow(/title/);
  });
});

describe("platform home: counts only", () => {
  it("counts organisations by state and open requests, with no tenant business data in it", async () => {
    const org = await createTestOrganization();
    await createCompany({ organizationId: org.id, name: "Hidden Customer Ltd" });
    const suspended = await adminDb.organization.create({ data: { name: "Home susp", slug: `home-susp-${randomUUID().slice(0, 8)}`, status: "SUSPENDED" } });
    await adminDb.platformDataRequest.create({ data: { organizationId: suspended.id, organizationSlug: suspended.slug, organizationName: suspended.name, kind: "EXPORT", approvalsRequired: 1 } });

    const home = await getPlatformHome({ probes: allOk });
    const [counts] = await getPlatformDb().$queryRaw<{ total: bigint; active: bigint; suspended: bigint }[]>`
      SELECT count(*)::bigint AS total, count(*) FILTER (WHERE status = 'ACTIVE')::bigint AS active, count(*) FILTER (WHERE status = 'SUSPENDED')::bigint AS suspended FROM platform_organization_counts`;
    // Other test files add organisations while this one runs, so the numbers can only have grown since the query.
    expect(home.organisations.total).toBeGreaterThanOrEqual(Number(counts!.total));
    expect(home.organisations.active).toBeGreaterThanOrEqual(Number(counts!.active));
    expect(home.organisations.suspended).toBeGreaterThanOrEqual(1);
    expect(home.requests.open).toBeGreaterThanOrEqual(1);
    expect(home.requests.awaitingApproval).toBeGreaterThanOrEqual(1);
    expect(home.health.overall).toBe("OPERATIONAL");

    const text = JSON.stringify(home);
    expect(text).not.toMatch(/Hidden Customer/);
    expect(text).not.toContain(org.slug);
    expect(text).not.toContain(org.name);
    // Only numbers, states and times: no strings that could be a name or a value.
    const walk = (value: unknown, path: string): void => {
      if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
      else if (typeof value === "string") expect(path, `string at ${path}`).toMatch(/\.(overall|status|component|generatedAt|runAt|trigger|problem|id)$/);
    };
    walk(home, "home");
  });
});

describe("the routes", () => {
  it("serve home, health and incidents to a platform admin and 404 to a tenant user", async () => {
    const home = await import("../src/app/api/platform/home/route");
    const health = await import("../src/app/api/platform/health/route");
    const incidents = await import("../src/app/api/platform/health/incidents/route");
    const resolve = await import("../src/app/api/platform/health/incidents/[incidentId]/resolve/route");

    expect((await home.GET()).status).toBe(200);
    expect((await (await health.GET()).json()).components).toHaveLength(5);
    const created = await incidents.POST(jsonRequest("/api/platform/health/incidents", "POST", { component: "JOBS", severity: "INFO", title: "Route incident" }));
    expect(created.status).toBe(200);
    const id = (await created.json()).id as string;
    expect((await incidents.POST(jsonRequest("/api/platform/health/incidents", "POST", { component: "JOBS" }))).status).toBe(400);
    expect((await (await incidents.GET()).json()).items.map((i: { id: string }) => i.id)).toContain(id);
    expect((await (await resolve.POST(jsonRequest("/api/platform/x", "POST"), ctxParams({ incidentId: id }))).json()).open).toBe(false);

    const org = await createTestOrganization();
    const { user } = await createTestMembership(org.id, "MANAGEMENT");
    holder.jar = cookieJar({ [SESSION_COOKIE_NAME]: (await createSession(user.id)).token });
    expect((await home.GET()).status).toBe(404);
    expect((await health.GET()).status).toBe(404);
    expect((await incidents.POST(jsonRequest("/api/platform/health/incidents", "POST", { component: "JOBS", severity: "INFO", title: "Nope" }))).status).toBe(404);
  });
});
