/**
 * FIG-805: the public REST API with personal API tokens (docs/M17_LANE_C_PUBLIC_API_WEBHOOKS.md).
 *
 * Covers: tokens stored hashed and shown once, expiry, last use, revocation; a token running as its owning membership (the same permission
 * checks, masking, tenant scoping); scopes; rate limits; the versioned routes with pages and idempotent creates; cross-organisation
 * isolation, in the service layer and in the database (RLS); and the generated OpenAPI document.
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The document route reads the browser session through next/headers when no token is sent; here nobody is signed in.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }), headers: async () => new Headers() }));
import { buildPublicApiDocument } from "../src/api/publicApi/openapi";
import { API_SCOPES, hashApiToken, API_RATE_LIMIT_PER_TOKEN } from "../src/auth/apiToken";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { createCompany } from "../src/services/companyService";
import { createDeal } from "../src/services/dealService";
import { createApiToken, listApiTokens, revokeApiToken } from "../src/services/apiTokenService";
import { updateOrganizationFlags } from "../src/services/platformFlagsService";
import { makePlatformAdmin, removeTestPlatformAdmins } from "./helpers/platform";
import { createTestContext, createTestOrganization, getPipelineStageId, getLeadStatusId } from "./helpers/fixtures";
import { apiRequest, createV2Organization, params, v2World } from "./helpers/laneC";
import { GET as listCompaniesRoute, POST as createCompanyRoute } from "../src/app/api/v1/companies/route";
import { GET as getCompanyRoute, PATCH as patchCompanyRoute } from "../src/app/api/v1/companies/[id]/route";
import { GET as listDealsRoute } from "../src/app/api/v1/deals/route";
import { GET as getDealRoute } from "../src/app/api/v1/deals/[id]/route";
import { GET as listLeadsRoute, POST as createLeadRoute } from "../src/app/api/v1/leads/route";
import { GET as listTasksRoute, POST as createTaskRoute } from "../src/app/api/v1/tasks/route";
import { GET as listActivitiesRoute, POST as createActivityRoute } from "../src/app/api/v1/activities/route";
import { GET as listContactsRoute, POST as createContactRoute } from "../src/app/api/v1/contacts/route";
import { GET as openapiRoute } from "../src/app/api/v1/openapi.json/route";

let world: Awaited<ReturnType<typeof v2World>>;
let mgmtToken: string;
let salesToken: string;
let mgmtTokenId: string;

const ALL_SCOPES = [...API_SCOPES];

beforeAll(async () => {
  world = await v2World();
  const m = await createApiToken(world.management, { name: "Management script", scopes: ALL_SCOPES });
  mgmtToken = m.token;
  mgmtTokenId = m.id;
  salesToken = (await createApiToken(world.sales, { name: "Sales script", scopes: ALL_SCOPES })).token;
});

afterAll(async () => {
  await removeTestPlatformAdmins();
});

describe("tokens: stored hashed, shown once, with expiry and revocation", () => {
  it("returns the plain token once and stores only its hash", async () => {
    const created = await createApiToken(world.management, { name: "Once", scopes: ["companies:read"], expiresInDays: 30 });
    expect(created.token).toMatch(/^fbk_[A-Za-z0-9_-]{43}$/);
    const row = await adminDb.apiToken.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.tokenHash).toBe(createHash("sha256").update(created.token).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(created.token);
    expect(row.tokenPrefix).toBe(created.token.slice(0, 12));
    // The list never carries the token again.
    const list = await listApiTokens(world.management);
    expect(JSON.stringify(list)).not.toContain(created.token);
    // The audit trail names the token, never its secret.
    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: world.org.id, action: "api_token.created", entityId: created.id } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(created.token);
  });

  it("sets an expiry (default 90 days, never longer than 365) and checks scopes and name", async () => {
    const dflt = await createApiToken(world.management, { name: "Default expiry", scopes: ["tasks:read"] });
    const days = (dflt.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);
    await expect(createApiToken(world.management, { name: "Forever", scopes: ["tasks:read"], expiresInDays: 4000 })).rejects.toThrow(/1 to 365/);
    await expect(createApiToken(world.management, { name: "No scopes", scopes: [] })).rejects.toThrow(/at least one scope/i);
    await expect(createApiToken(world.management, { name: "Odd scope", scopes: ["everything:write"] })).rejects.toThrow(/Unknown scope/);
    await expect(createApiToken(world.management, { name: " ", scopes: ["tasks:read"] })).rejects.toThrow(/name/i);
  });

  it("lets a member see and revoke their own tokens; Management sees and revokes everyone's; a member cannot touch another's", async () => {
    const mine = await createApiToken(world.sales, { name: "Sales mine", scopes: ["tasks:read"] });
    const salesList = await listApiTokens(world.sales);
    expect(salesList.scope).toBe("own");
    expect(salesList.items.every((t) => t.membershipId === world.sales.membershipId)).toBe(true);
    const mgmtList = await listApiTokens(world.management);
    expect(mgmtList.scope).toBe("organisation");
    expect(mgmtList.items.some((t) => t.id === mine.id)).toBe(true);

    // Delivery has no token of its own here; it cannot revoke Sales's, and learns nothing about it.
    await expect(revokeApiToken(world.delivery, mine.id)).rejects.toThrow(/not found/i);
    const revokedByManager = await revokeApiToken(world.management, mine.id);
    expect(revokedByManager.status).toBe("REVOKED");
    const audit = await adminDb.auditEvent.findFirst({ where: { organizationId: world.org.id, action: "api_token.revoked", entityId: mine.id } });
    expect(audit?.actorMembershipId).toBe(world.management.membershipId);
  });

  it("is not available below release V2 (explained, not a silent failure)", async () => {
    const v1 = await createTestOrganization("V1 Org");
    const ctx = await createTestContext(v1.id, "MANAGEMENT", "lanec.v1");
    await expect(createApiToken(ctx, { name: "Too early", scopes: ["tasks:read"] })).rejects.toMatchObject({ name: "FeatureUnavailableError" });
  });
});

describe("authentication", () => {
  it("refuses a missing, malformed, unknown, revoked or expired token with the same 401", async () => {
    const bodies: unknown[] = [];
    for (const token of [null, "not-a-token", "fbk_" + "x".repeat(43)]) {
      const res = await listCompaniesRoute(apiRequest("/api/v1/companies", token));
      expect(res.status).toBe(401);
      bodies.push(await res.json());
    }
    const revoked = await createApiToken(world.management, { name: "Revoke me", scopes: ["companies:read"] });
    expect((await listCompaniesRoute(apiRequest("/api/v1/companies", revoked.token))).status).toBe(200);
    await revokeApiToken(world.management, revoked.id);
    const afterRevoke = await listCompaniesRoute(apiRequest("/api/v1/companies", revoked.token));
    expect(afterRevoke.status).toBe(401);
    bodies.push(await afterRevoke.json());

    const expiring = await createApiToken(world.management, { name: "Expire me", scopes: ["companies:read"] });
    await adminDb.apiToken.update({ where: { id: expiring.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await listCompaniesRoute(apiRequest("/api/v1/companies", expiring.token));
    expect(expired.status).toBe(401);
    bodies.push(await expired.json());

    const messages = new Set(bodies.map((b) => (b as { message: string }).message));
    expect(messages.size).toBe(1);
    // A token on a cookie-only route is not a session, and a session is not a token: a Bearer header is the only credential here.
    expect((await listCompaniesRoute(new Request("http://localhost/api/v1/companies", { headers: { cookie: "figbloom_session=abc" } }))).status).toBe(401);
  });

  it("records the last use, at most once a minute", async () => {
    const t = await createApiToken(world.management, { name: "Used", scopes: ["companies:read"] });
    expect((await adminDb.apiToken.findUniqueOrThrow({ where: { id: t.id } })).lastUsedAt).toBeNull();
    await listCompaniesRoute(apiRequest("/api/v1/companies", t.token));
    const first = (await adminDb.apiToken.findUniqueOrThrow({ where: { id: t.id } })).lastUsedAt;
    expect(first).not.toBeNull();
    await listCompaniesRoute(apiRequest("/api/v1/companies", t.token));
    expect((await adminDb.apiToken.findUniqueOrThrow({ where: { id: t.id } })).lastUsedAt?.getTime()).toBe(first!.getTime());
  });

  it("enforces scopes: read and write are separate, and a missing scope is an explained 403", async () => {
    const readOnly = await createApiToken(world.management, { name: "Read only", scopes: ["companies:read"] });
    expect((await listCompaniesRoute(apiRequest("/api/v1/companies", readOnly.token))).status).toBe(200);
    const write = await createCompanyRoute(apiRequest("/api/v1/companies", readOnly.token, { method: "POST", body: { name: "Nope Co" } }));
    expect(write.status).toBe(403);
    const body = (await write.json()) as { code: string; message: string };
    expect(body.code).toBe("FORBIDDEN");
    expect(body.message).toMatch(/companies:write/);
    expect(await adminDb.company.count({ where: { organizationId: world.org.id, name: "Nope Co" } })).toBe(0);
    const otherEntity = await listDealsRoute(apiRequest("/api/v1/deals", readOnly.token));
    expect(otherEntity.status).toBe(403);
  });

  it("stops working when its owner is removed, and when the organisation is suspended", async () => {
    const org = await createV2Organization("Lifecycle Org");
    const mgmt = await createTestContext(org.id, "MANAGEMENT", "lanec.life");
    const member = await createTestContext(org.id, "SALES", "lanec.life.sales");
    const tok = await createApiToken(member, { name: "Soon gone", scopes: ["companies:read"] });
    expect((await listCompaniesRoute(apiRequest("/api/v1/companies", tok.token))).status).toBe(200);

    await adminDb.membership.update({ where: { id: member.membershipId }, data: { status: "REMOVED", removedAt: new Date() } });
    expect((await listCompaniesRoute(apiRequest("/api/v1/companies", tok.token))).status).toBe(401);

    const tok2 = await createApiToken(mgmt, { name: "Org suspended", scopes: ["companies:read"] });
    expect((await listCompaniesRoute(apiRequest("/api/v1/companies", tok2.token))).status).toBe(200);
    await adminDb.organization.update({ where: { id: org.id }, data: { status: "SUSPENDED" } });
    expect((await listCompaniesRoute(apiRequest("/api/v1/companies", tok2.token))).status).toBeGreaterThanOrEqual(403);
  });

  it("is rate-limited per token", async () => {
    const t = await createApiToken(world.management, { name: "Busy", scopes: ["companies:read"] });
    await adminDb.authRateLimitAttempt.createMany({ data: Array.from({ length: API_RATE_LIMIT_PER_TOKEN }, () => ({ action: "API_TOKEN" as const, scope: "token", key: t.id })) });
    const res = await listCompaniesRoute(apiRequest("/api/v1/companies", t.token));
    expect(res.status).toBe(429);
    expect(((await res.json()) as { code: string }).code).toBe("RATE_LIMITED");
    // Another token is not affected.
    expect((await listCompaniesRoute(apiRequest("/api/v1/companies", mgmtToken))).status).toBe(200);
  });
});

describe("the organisation's monthly API-call limit (FIG-1184)", () => {
  it("counts calls made with a token and answers 429 with a friendly message once the limit is used", async () => {
    const org = await createV2Organization("LaneC Limit");
    const mgmt = await createTestContext(org.id, "MANAGEMENT", "lanec.limit");
    const { token } = await createApiToken(mgmt, { name: "Limited", scopes: ["companies:read"] });
    const admin = await makePlatformAdmin("lanec-limit-admin");
    await updateOrganizationFlags(admin.actor, org.id, { limits: { apiCallsPerMonth: 2 }, reason: "Test limit for the public API" });
    expect((await listCompaniesRoute(apiRequest("/api/v1/companies", token))).status).toBe(200);
    expect((await listCompaniesRoute(apiRequest("/api/v1/companies", token))).status).toBe(200);
    const refused = await listCompaniesRoute(apiRequest("/api/v1/companies", token));
    expect(refused.status).toBe(429);
    const body = (await refused.json()) as { code: string; message: string };
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.message).toMatch(/API calls/);
    // Another organisation is not affected.
    expect((await listCompaniesRoute(apiRequest("/api/v1/companies", mgmtToken))).status).toBe(200);
  });
});

describe("the versioned routes", () => {
  it("creates, reads, changes and lists a company with the standard page envelope, and honours Idempotency-Key", async () => {
    await createCompany(world.management, { name: "Second Co" });
    const key = `key-${Date.now()}-abcdef`;
    const create = () => createCompanyRoute(apiRequest("/api/v1/companies", mgmtToken, { method: "POST", body: { name: "Idem Co" }, headers: { "idempotency-key": key } }));
    const first = await create();
    expect(first.status).toBe(200);
    const created = (await first.json()) as { company: { id: string; name: string } };
    const replay = await create();
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(((await replay.json()) as typeof created).company.id).toBe(created.company.id);
    expect(await adminDb.company.count({ where: { organizationId: world.org.id, name: "Idem Co" } })).toBe(1);

    const id = created.company.id;
    const got = await getCompanyRoute(apiRequest(`/api/v1/companies/${id}`, mgmtToken), params({ id }));
    expect(((await got.json()) as { name: string }).name).toBe("Idem Co");
    const patched = await patchCompanyRoute(apiRequest(`/api/v1/companies/${id}`, mgmtToken, { method: "PATCH", body: { industry: "Software" } }), params({ id }));
    expect(patched.status).toBe(200);

    const list = await listCompaniesRoute(apiRequest("/api/v1/companies?limit=1", mgmtToken));
    const page = (await list.json()) as { items: unknown[]; total: number; pageSize: number; nextCursor: string | null };
    expect(page.items).toHaveLength(1);
    expect(page.pageSize).toBe(1);
    expect(page.total).toBeGreaterThan(1);
    expect(page.nextCursor).not.toBeNull();
    const next = await listCompaniesRoute(apiRequest(`/api/v1/companies?limit=1&cursor=${page.nextCursor}`, mgmtToken));
    expect(((await next.json()) as { items: Array<{ id: string }> }).items).toHaveLength(1);
    // Bad input is the standard 400 envelope.
    const bad = await createCompanyRoute(apiRequest("/api/v1/companies", mgmtToken, { method: "POST", body: {} }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { fieldErrors: unknown[] }).fieldErrors.length).toBeGreaterThan(0);
  });

  it("covers contacts, leads, tasks and activities", async () => {
    const company = await createCompany(world.management, { name: "Entity Co" });
    const contact = await createContactRoute(apiRequest("/api/v1/contacts", mgmtToken, { method: "POST", body: { firstName: "Amina", companyId: company.company.id } }));
    expect(contact.status).toBe(200);
    expect((await listContactsRoute(apiRequest(`/api/v1/contacts?companyId=${company.company.id}`, mgmtToken))).status).toBe(200);

    const leadStatusId = await getLeadStatusId(world.org.id);
    const lead = await createLeadRoute(apiRequest("/api/v1/leads", mgmtToken, { method: "POST", body: { leadStatusId, companyId: company.company.id } }));
    expect(lead.status).toBe(200);
    const leadId = ((await lead.json()) as { lead: { id: string } }).lead.id;
    expect(((await (await listLeadsRoute(apiRequest("/api/v1/leads", mgmtToken))).json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);

    const task = await createTaskRoute(apiRequest("/api/v1/tasks", mgmtToken, { method: "POST", body: { title: "Call back", leadId } }));
    expect(task.status).toBe(200);
    expect((await listTasksRoute(apiRequest(`/api/v1/tasks?leadId=${leadId}`, mgmtToken))).status).toBe(200);

    const activity = await createActivityRoute(apiRequest("/api/v1/activities", mgmtToken, { method: "POST", body: { type: "NOTE", subject: "Met", leadId } }));
    expect(activity.status).toBe(200);
    const timeline = await listActivitiesRoute(apiRequest(`/api/v1/activities?leadId=${leadId}`, mgmtToken));
    expect(((await timeline.json()) as { items: unknown[] }).items.length).toBe(1);
    // A timeline belongs to one record.
    expect((await listActivitiesRoute(apiRequest("/api/v1/activities", mgmtToken))).status).toBe(400);
  });
});

describe("a token runs as its owner", () => {
  it("masks deal values for a role that may not see them, exactly as the application does", async () => {
    const company = await createCompany(world.management, { name: "Value Co" });
    const stageId = await getPipelineStageId(world.org.id);
    const created = await createDeal(world.management, { companyId: company.company.id, pipelineStageId: stageId, value: 7654321 });
    const dealId = (created as { id: string }).id;

    const asManagement = (await (await getDealRoute(apiRequest(`/api/v1/deals/${dealId}`, mgmtToken), params({ id: dealId }))).json()) as { value: unknown; masked: boolean };
    expect(Number(asManagement.value)).toBe(7654321);
    expect(asManagement.masked).toBe(false);

    // Sales does not own this deal: the list may not show it, and if it does the value is hidden.
    const salesRes = await getDealRoute(apiRequest(`/api/v1/deals/${dealId}`, salesToken), params({ id: dealId }));
    if (salesRes.status === 200) {
      const body = await salesRes.json();
      expect(JSON.stringify(body)).not.toContain("7654321");
    } else {
      expect([403, 404]).toContain(salesRes.status);
    }
    const salesList = await (await listDealsRoute(apiRequest("/api/v1/deals", salesToken))).text();
    expect(salesList).not.toContain("7654321");
  });

  it("applies the owner's permissions to writes: a Delivery token cannot create a lead", async () => {
    const deliveryToken = (await createApiToken(world.delivery, { name: "Delivery script", scopes: ALL_SCOPES })).token;
    const leadStatusId = await getLeadStatusId(world.org.id);
    const res = await createLeadRoute(apiRequest("/api/v1/leads", deliveryToken, { method: "POST", body: { leadStatusId } }));
    expect(res.status).toBe(403);
  });

  it("never reaches another organisation's records, with an id or without", async () => {
    const other = await v2World();
    const otherToken = (await createApiToken(other.management, { name: "Other org", scopes: ALL_SCOPES })).token;
    const secret = await createCompany(other.management, { name: "Other Org Secret Co" });

    const mine = await (await listCompaniesRoute(apiRequest("/api/v1/companies?limit=100", mgmtToken))).text();
    expect(mine).not.toContain("Other Org Secret Co");
    const byId = await getCompanyRoute(apiRequest(`/api/v1/companies/${secret.company.id}`, mgmtToken), params({ id: secret.company.id }));
    expect(byId.status).toBe(404);
    const patch = await patchCompanyRoute(apiRequest(`/api/v1/companies/${secret.company.id}`, mgmtToken, { method: "PATCH", body: { name: "Hijacked" } }), params({ id: secret.company.id }));
    expect(patch.status).toBe(404);
    expect((await adminDb.company.findUniqueOrThrow({ where: { id: secret.company.id } })).name).toBe("Other Org Secret Co");
    // And the other organisation's own token sees its own.
    expect(await (await listCompaniesRoute(apiRequest("/api/v1/companies?limit=100", otherToken))).text()).toContain("Other Org Secret Co");
  });
});

describe("tenant isolation of the token table (row-level security)", () => {
  it("another organisation's context cannot read or change tokens, and no context sees none", async () => {
    const other = await createV2Organization("RLS Other");
    const rows = await withOrgContext(other.id, (tx) => tx.apiToken.findMany({ where: { organizationId: world.org.id } }));
    expect(rows).toHaveLength(0);
    const changed = await withOrgContext(other.id, (tx) => tx.apiToken.updateMany({ where: { id: mgmtTokenId }, data: { revokedAt: new Date() } }));
    expect(changed.count).toBe(0);
    expect((await adminDb.apiToken.findUniqueOrThrow({ where: { id: mgmtTokenId } })).revokedAt).toBeNull();
    await expect(
      withOrgContext(other.id, (tx) =>
        tx.apiToken.create({ data: { organizationId: world.org.id, membershipId: world.management.membershipId, name: "Smuggled", tokenPrefix: "fbk_smuggled", tokenHash: hashApiToken("smuggled"), scopes: ["tasks:read"] } }),
      ),
    ).rejects.toThrow();
  });

  it("a token cannot name a membership of another organisation (composite foreign key)", async () => {
    const other = await createV2Organization("FK Other");
    const outsider = await createTestContext(other.id, "SALES", "lanec.fk");
    await expect(
      adminDb.apiToken.create({ data: { organizationId: world.org.id, membershipId: outsider.membershipId, name: "Cross", tokenPrefix: "fbk_cross", tokenHash: hashApiToken("cross"), scopes: ["tasks:read"] } }),
    ).rejects.toThrow();
  });
});

describe("the OpenAPI document", () => {
  it("is generated from the schemas and covers the public routes, the scopes and the webhook payload", () => {
    const doc = buildPublicApiDocument() as { openapi: string; paths: Record<string, Record<string, { operationId: string; "x-required-scope"?: string }>>; "x-webhooks": { events: string[] } };
    expect(doc.openapi).toBe("3.1.0");
    for (const entity of ["companies", "contacts", "leads", "deals", "tasks", "activities"]) expect(doc.paths[`/api/v1/${entity}`]).toBeDefined();
    expect(doc.paths["/api/v1/companies/{id}"]!.patch!["x-required-scope"]).toBe("companies:write");
    expect(doc["x-webhooks"].events).toContain("deal.won");
    const ids = Object.values(doc.paths).flatMap((p) => Object.values(p).map((o) => o.operationId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is served to a token holder and to nobody anonymous", async () => {
    expect((await openapiRoute(apiRequest("/api/v1/openapi.json", null))).status).toBe(401);
    const withToken = await openapiRoute(apiRequest("/api/v1/openapi.json", (await createApiToken(world.management, { name: "Docs", scopes: ["tasks:read"] })).token));
    expect(withToken.status).toBe(200);
    expect(((await withToken.json()) as { openapi: string }).openapi).toBe("3.1.0");
  });
});
