import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/lib/apiErrors";
import { ValidationError } from "../src/auth/errors";
import { acceptMembershipInvite } from "../src/services/authService";
import { resolveRequestContext } from "../src/auth/requestContext";
import { SESSION_COOKIE_NAME, createSession } from "../src/auth/session";
import { adminDb } from "../src/db/adminClient";
import { getPlatformDb } from "../src/db/platformClient";
import { createCompany } from "../src/repositories/companies";
import { describeOrganizationDefaults } from "../src/services/organizationDefaults";
import { listAuditEvents } from "../src/services/platformAuditService";
import { checkSlug, getOrganizationDetail, listOrganizations, previewProvisioningDefaults, provisionPlatformOrganization } from "../src/services/platformOrganizationService";
import { createTestMembership, createTestOrganization } from "./helpers/fixtures";
import { cookieJar, ctxParams, jsonRequest, makePlatformAdmin, removeTestPlatformAdmins, type TestPlatformAdmin } from "./helpers/platform";
import { discoverRoutes, fillParams, invoke } from "./helpers/routeHarness";

/**
 * FIG-1136 (B6.04): the platform's organisations API. List with filters, slug check, defaults preview, provisioning
 * (idempotent, audited, usable end to end) and detail, all counts only.
 */
const holder = vi.hoisted(() => ({ jar: { get: (_name: string): { value: string } | undefined => undefined }, invites: [] as { to: string; url: string }[] }));
vi.mock("next/headers", () => ({ cookies: async () => holder.jar }));
// Capture the invite link instead of sending it: the platform API never returns it, so this is the only way to accept it.
vi.mock("../src/auth/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/auth/email")>()),
  sendMembershipInviteEmail: async (to: string, url: string) => {
    holder.invites.push({ to, url });
  },
}));

let admin: TestPlatformAdmin;
beforeEach(async () => {
  admin ??= await makePlatformAdmin("provisioner");
  holder.jar = admin.jar;
  holder.invites.length = 0;
});
afterEach(() => {
  holder.jar = cookieJar({});
});
afterAll(async () => {
  await removeTestPlatformAdmins();
  await getPlatformDb().$disconnect();
});

const unique = () => randomUUID().slice(0, 8);
const input = (over: Partial<{ name: string; slug: string; ownerName: string; ownerEmail: string }> = {}) => {
  const id = unique();
  return { name: `Provisioned ${id}`, slug: `prov-${id}`, ownerName: "First Owner", ownerEmail: `owner.${id}@example.test`, ...over };
};

describe("slug check and defaults preview (PL3)", () => {
  it("says whether a slug is free, and why not", async () => {
    const free = `free-${unique()}`;
    expect(await checkSlug(free)).toMatchObject({ slug: free, available: true, problem: null });
    expect(await checkSlug("  Mixed-CASE-ok ")).toMatchObject({ slug: "mixed-case-ok", available: true });
    expect(await checkSlug("ab")).toMatchObject({ available: false, problem: "TOO_SHORT" });
    expect(await checkSlug("a".repeat(41))).toMatchObject({ available: false, problem: "TOO_LONG" });
    for (const bad of ["has space", "under_score", "-leading", "trailing-", "double--hyphen", "ünï"]) {
      expect(await checkSlug(bad), bad).toMatchObject({ available: false, problem: "INVALID" });
    }
    for (const reserved of ["platform", "admin", "api", "login"]) {
      expect(await checkSlug(reserved), reserved).toMatchObject({ available: false, problem: "RESERVED" });
    }
  });

  it("names a taken slug and suggests a free one", async () => {
    const org = await createTestOrganization();
    const result = await checkSlug(org.slug);
    expect(result).toMatchObject({ available: false, problem: "TAKEN" });
    expect(result.suggestion).toBe(`${org.slug}-2`);
    expect((await checkSlug(result.suggestion!)).available).toBe(true);
  });

  it("previews exactly what the seed will create", async () => {
    const preview = previewProvisioningDefaults();
    expect(preview.catalogues).toEqual(describeOrganizationDefaults());
    expect(preview.catalogues.pipelineStages).toEqual(["Solution Presented", "Proposal Sent", "Negotiation", "Closed Won", "Closed Lost"]);
    expect(preview.firstUserRole).toBe("MANAGEMENT");

    const made = await provisionPlatformOrganization(admin.actor, input());
    expect(await adminDb.pipelineStage.count({ where: { organizationId: made.organizationId } })).toBe(preview.catalogues.pipelineStages.length);
    expect(await adminDb.leadSource.count({ where: { organizationId: made.organizationId } })).toBe(preview.catalogues.leadSources.length);
    expect(await adminDb.service.count({ where: { organizationId: made.organizationId } })).toBe(preview.catalogues.services.length);
  });
});

describe("provisioning (PL3)", () => {
  it("makes an organisation that works end to end: seeded defaults, first Management invite, accepted and signed in", async () => {
    const body = input();
    const made = await provisionPlatformOrganization(admin.actor, body, { requestId: "req-provision-1" });
    expect(made).toMatchObject({ slug: body.slug, name: body.name, status: "ACTIVE", owner: { email: body.ownerEmail, invitePending: true }, replayed: false });
    expect(await adminDb.organization.findUniqueOrThrow({ where: { id: made.organizationId } })).toMatchObject({ status: "ACTIVE" });

    // The invite went to the owner, and its link is not in what the platform admin got back.
    expect(holder.invites).toHaveLength(1);
    expect(holder.invites[0]!.to).toBe(body.ownerEmail);
    const url = holder.invites[0]!.url;
    expect(JSON.stringify(made)).not.toContain(new URL(url).searchParams.get("token")!);
    expect(JSON.stringify(made)).not.toMatch(/accept-invite|acceptUrl|token/i);

    const membership = await adminDb.membership.findUniqueOrThrow({ where: { id: made.owner.membershipId }, include: { role: true } });
    expect(membership).toMatchObject({ organizationId: made.organizationId, status: "PENDING" });
    expect(membership.role.key).toBe("MANAGEMENT");

    // The owner accepts, signs in, and uses the organisation.
    const accepted = await acceptMembershipInvite(new URL(url).searchParams.get("token")!, "a-long-enough-password-1");
    expect(accepted.organizationSlug).toBe(body.slug);
    const ctx = await resolveRequestContext(body.slug, cookieJar({ [SESSION_COOKIE_NAME]: (accepted as { token: string }).token }));
    expect(ctx).toMatchObject({ organizationId: made.organizationId, roleKey: "MANAGEMENT" });
    expect(ctx.permissionKeys.length).toBeGreaterThan(10);
  });

  it("writes an audit entry naming who provisioned what, and no secret", async () => {
    const made = await provisionPlatformOrganization(admin.actor, input(), { requestId: "req-provision-2" });
    const entries = (await listAuditEvents({ organizationId: made.organizationId })).items;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "organization.provisioned",
      actorIdentityId: admin.id,
      actorLabel: admin.email,
      targetType: "Organization",
      targetId: made.organizationId,
      organizationSlug: made.slug,
      requestId: "req-provision-2",
    });
    expect(JSON.stringify(entries[0])).not.toMatch(/token|password/i);
  });

  it("validates the input and refuses a taken or reserved slug", async () => {
    const taken = await createTestOrganization();
    await expect(provisionPlatformOrganization(admin.actor, input({ slug: taken.slug }))).rejects.toThrow(/already exists/);
    await expect(provisionPlatformOrganization(admin.actor, input({ slug: "platform" }))).rejects.toThrow(/reserved/);
    await expect(provisionPlatformOrganization(admin.actor, input({ slug: "Bad Slug" }))).rejects.toThrow(ValidationError);
    await expect(provisionPlatformOrganization(admin.actor, input({ name: " " }))).rejects.toThrow(/Name is required/);
    await expect(provisionPlatformOrganization(admin.actor, input({ ownerEmail: "not-an-email" }))).rejects.toThrow(/valid email/);
    await expect(provisionPlatformOrganization(admin.actor, input({ ownerName: "" }))).rejects.toThrow(/name is required/);
    // Nothing was created or audited by the refused attempts.
    expect(await adminDb.organization.count({ where: { name: { startsWith: "Provisioned" }, slug: "platform" } })).toBe(0);
    expect(holder.invites).toHaveLength(0);
  });

  it("is idempotent: the same key and body replays one organisation, a different body is refused", async () => {
    const body = input();
    const key = `key-${randomUUID()}`;
    const first = await provisionPlatformOrganization(admin.actor, body, { idempotencyKey: key });
    const again = await provisionPlatformOrganization(admin.actor, body, { idempotencyKey: key });
    expect(first.replayed).toBe(false);
    expect(again).toMatchObject({ replayed: true, organizationId: first.organizationId, slug: first.slug });
    expect(await adminDb.organization.count({ where: { slug: body.slug } })).toBe(1);
    expect(holder.invites).toHaveLength(1);
    expect((await listAuditEvents({ organizationId: first.organizationId })).items).toHaveLength(1);

    await expect(provisionPlatformOrganization(admin.actor, { ...body, name: "Another name" }, { idempotencyKey: key })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    await expect(provisionPlatformOrganization(admin.actor, body, { idempotencyKey: "short" })).rejects.toThrow(/Idempotency-Key/);
    expect(ApiError).toBeDefined();
  });

  it("does not poison the key when the create fails, so the fixed input can use it again", async () => {
    const key = `key-${randomUUID()}`;
    const taken = await createTestOrganization();
    await expect(provisionPlatformOrganization(admin.actor, input({ slug: taken.slug }), { idempotencyKey: key })).rejects.toThrow(/already exists/);
    // Same key, same body would fail the same way; the key itself is free again (a different body would otherwise be IDEMPOTENCY_KEY_REUSED).
    const fixed = await provisionPlatformOrganization(admin.actor, input({ slug: `fixed-${unique()}` }), { idempotencyKey: key });
    expect(fixed.replayed).toBe(false);
  });

  it("is idempotent under a double submit (two at once make one organisation)", async () => {
    const body = input();
    const key = `key-${randomUUID()}`;
    const results = await Promise.allSettled([
      provisionPlatformOrganization(admin.actor, body, { idempotencyKey: key }),
      provisionPlatformOrganization(admin.actor, body, { idempotencyKey: key }),
    ]);
    expect(await adminDb.organization.count({ where: { slug: body.slug } })).toBe(1);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "IDEMPOTENCY_IN_PROGRESS" });
  });
});

describe("list and detail (PL2, PL4): counts only", () => {
  it("filters by name, slug, status and date, sorts, and pages", async () => {
    const tag = unique();
    const a = await adminDb.organization.create({ data: { name: `Zeta ${tag}`, slug: `zeta-${tag}` } });
    const b = await adminDb.organization.create({ data: { name: `Alpha ${tag}`, slug: `alpha-${tag}`, status: "SUSPENDED" } });
    await createTestMembership(a.id, "MANAGEMENT");
    await createTestMembership(a.id, "SALES");

    const byName = await listOrganizations({ q: tag, sort: "name", direction: "asc" });
    expect(byName.items.map((o) => o.slug)).toEqual([`alpha-${tag}`, `zeta-${tag}`]);
    expect((await listOrganizations({ q: `ZETA-${tag}` })).items.map((o) => o.id)).toEqual([a.id]);
    expect((await listOrganizations({ q: tag, status: "SUSPENDED" })).items.map((o) => o.id)).toEqual([b.id]);
    expect((await listOrganizations({ q: tag, sort: "members", direction: "desc" })).items[0]!.id).toBe(a.id);
    expect((await listOrganizations({ q: tag, createdFrom: new Date(Date.now() + 60_000) })).items).toHaveLength(0);

    const page1 = await listOrganizations({ q: tag, sort: "name", pageSize: 1 });
    const page2 = await listOrganizations({ q: tag, sort: "name", pageSize: 1, page: 2 });
    expect(page1).toMatchObject({ total: 2, pageCount: 2, pageSize: 1 });
    expect([page1.items[0]!.slug, page2.items[0]!.slug]).toEqual([`alpha-${tag}`, `zeta-${tag}`]);
    expect(Object.keys(byName.statusCounts).length).toBeGreaterThan(0);
    await expect(listOrganizations({ status: "NONSENSE" })).rejects.toThrow(ValidationError);
    // A literal % or _ in the search is text, not a wildcard.
    expect((await listOrganizations({ q: "%" })).items.every((o) => (o.name + o.slug).includes("%"))).toBe(true);
  });

  it("shows operational counts, the owner contact and the trail, and never a customer name or a value", async () => {
    const made = await provisionPlatformOrganization(admin.actor, input());
    const company = await createCompany({ organizationId: made.organizationId, name: "Hidden Customer Ltd" });
    expect(company.id).toBeTruthy();
    await adminDb.organizationLifecycleEvent.create({ data: { organizationId: made.organizationId, fromStatus: "ACTIVE", toStatus: "ACTIVE", action: "note", reason: "trail check" } });

    const detail = await getOrganizationDetail(made.organizationId);
    expect(detail).toMatchObject({
      id: made.organizationId,
      slug: made.slug,
      status: "ACTIVE",
      counts: { companies: 1, members: 1, activeMembers: 0 },
      timezone: "Africa/Nairobi",
      defaultCurrency: "KES",
      owner: { email: made.owner.email, name: "First Owner", invitePending: true },
    });
    expect(detail!.lifecycle[0]).toMatchObject({ action: "note", reason: "trail check" });
    expect(detail!.recentAudit.map((e) => e.action)).toContain("organization.provisioned");
    expect(JSON.stringify(detail)).not.toMatch(/Hidden Customer/);
    expect(await getOrganizationDetail(randomUUID())).toBeNull();
  });

  it("the platform database role still cannot read any tenant row behind those numbers", async () => {
    const org = await createTestOrganization();
    await createCompany({ organizationId: org.id, name: "Another Hidden Co" });
    await expect(getPlatformDb().$queryRawUnsafe(`SELECT name FROM companies LIMIT 1`)).rejects.toThrow(/permission denied/i);
    await expect(getPlatformDb().$queryRawUnsafe(`SELECT * FROM memberships LIMIT 1`)).rejects.toThrow(/permission denied/i);
  });
});

describe("the routes", () => {
  it("serve a platform admin end to end, with the standard envelope on errors", async () => {
    const list = await import("../src/app/api/platform/organizations/route");
    const slugCheck = await import("../src/app/api/platform/organizations/slug-check/route");
    const preview = await import("../src/app/api/platform/organizations/defaults-preview/route");
    const detail = await import("../src/app/api/platform/organizations/[organizationId]/route");

    const body = input();
    expect((await (await slugCheck.GET(jsonRequest(`/api/platform/organizations/slug-check?slug=${body.slug}`, "GET"))).json())).toMatchObject({ available: true });
    expect((await slugCheck.GET(jsonRequest("/api/platform/organizations/slug-check", "GET"))).status).toBe(400);
    expect((await (await preview.GET()).json()).catalogues.pipelineStages).toHaveLength(5);

    const key = `key-${randomUUID()}`;
    const created = await list.POST(jsonRequest("/api/platform/organizations", "POST", body, { "idempotency-key": key }));
    expect(created.status).toBe(201);
    const made = await created.json();
    const replay = await list.POST(jsonRequest("/api/platform/organizations", "POST", body, { "idempotency-key": key }));
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect((await replay.json()).organizationId).toBe(made.organizationId);

    const bad = await list.POST(jsonRequest("/api/platform/organizations", "POST", { name: "x" }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    expect((await list.POST(jsonRequest("/api/platform/organizations", "POST", { ...body, extra: 1 }))).status).toBe(400);

    const found = await list.GET(jsonRequest(`/api/platform/organizations?q=${body.slug}&status=ACTIVE`, "GET"));
    expect((await found.json()).items.map((o: { id: string }) => o.id)).toEqual([made.organizationId]);
    expect((await list.GET(jsonRequest("/api/platform/organizations?sort=bogus", "GET"))).status).toBe(400);

    const one = await detail.GET(jsonRequest("/api/platform/x", "GET"), ctxParams({ organizationId: made.organizationId }));
    expect(one.status).toBe(200);
    expect((await detail.GET(jsonRequest("/api/platform/x", "GET"), ctxParams({ organizationId: randomUUID() }))).status).toBe(404);
  });

  it("answer 404 to a signed-out caller and to a tenant user (Management included), on every platform route", async () => {
    const org = await createTestOrganization();
    const { user } = await createTestMembership(org.id, "MANAGEMENT");
    const tenant = await createSession(user.id);
    // The console backend's own routes (sign-in routes under /api/platform/auth are public by design and belong to B6.02).
    const mine = /^\/api\/platform\/(organizations|home|health|audit|data-requests)(\/|$)/;
    const routes = discoverRoutes().filter((r) => mine.test(r.path));
    expect(routes.length).toBeGreaterThanOrEqual(19);

    for (const jar of [cookieJar({}), cookieJar({ [SESSION_COOKIE_NAME]: tenant.token, figbloom_platform_session: tenant.token })]) {
      holder.jar = jar;
      for (const route of routes) {
        for (const method of route.methods) {
          const result = await invoke(route, method, fillParams(route, org.slug));
          expect(result.status, `${method} ${route.path}`).toBe(404);
        }
      }
    }
  });
});
