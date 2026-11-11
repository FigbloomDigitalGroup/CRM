/**
 * G3.01 independent security review (FIG-1191), public API and API tokens (FIG-805): attacks written by the reviewer, not the builders.
 * A passing test shows a defence holds. A test marked `it.fails` is a confirmed gap, written up in docs/M17_SECURITY_REVIEW_G3_01.md.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }), headers: async () => new Headers() }));
import { API_RATE_LIMIT_PER_ADDRESS, API_SCOPES, hashApiToken } from "../src/auth/apiToken";
import { adminDb } from "../src/db/adminClient";
import { resolveActiveMembership } from "../src/repositories/memberships";
import { createApiToken, revokeTokensOfMembership } from "../src/services/apiTokenService";
import { createCompany } from "../src/services/companyService";
import { createDeal, updateDeal } from "../src/services/dealService";
import { setOrganizationRelease } from "../src/services/featureService";
import { createRole } from "../src/services/roleEditorService";
import { createTask } from "../src/services/taskService";
import { removeTestPlatformAdmins } from "./helpers/platform";
import { createTestContext, createTestMembership, getLeadStatusId, getPipelineStageId } from "./helpers/fixtures";
import { apiRequest, params, v2World } from "./helpers/laneC";
import { GET as listCompaniesRoute, POST as createCompanyRoute } from "../src/app/api/v1/companies/route";
import { PATCH as patchCompanyRoute } from "../src/app/api/v1/companies/[id]/route";
import { GET as listContactsRoute, POST as createContactRoute } from "../src/app/api/v1/contacts/route";
import { GET as listDealsRoute } from "../src/app/api/v1/deals/route";
import { GET as getDealRoute, PATCH as patchDealRoute } from "../src/app/api/v1/deals/[id]/route";
import { GET as listLeadsRoute, POST as createLeadRoute } from "../src/app/api/v1/leads/route";
import { GET as listTasksRoute, POST as createTaskRoute } from "../src/app/api/v1/tasks/route";
import { GET as listActivitiesRoute } from "../src/app/api/v1/activities/route";

const ALL = [...API_SCOPES];
const VALUE_1 = "7654321";
const VALUE_2 = "1111111";
const LEAK = new RegExp(`${VALUE_1}|${VALUE_2}`);

let world: Awaited<ReturnType<typeof v2World>>;
let other: Awaited<ReturnType<typeof v2World>>;
let dealId: string;
let companyId: string;
let mgmtToken: string;
let salesToken: string;
let deliveryToken: string;
let hiddenToken: string;
let hiddenCtx: Awaited<ReturnType<typeof createTestContext>>;

afterAll(async () => {
  await removeTestPlatformAdmins();
});

beforeAll(async () => {
  world = await v2World();
  other = await v2World();
  const company = await createCompany(world.management, { name: "Review Co" });
  companyId = company.company.id;
  const stageId = await getPipelineStageId(world.org.id);
  const deal = (await createDeal(world.management, { companyId, pipelineStageId: stageId, value: 1111111 })) as { id: string };
  dealId = deal.id;
  // A value change leaves a trail on the deal; the sentinel must not reach a role that may not see values, in any response.
  await updateDeal(world.management, dealId, { value: 7654321 });
  mgmtToken = (await createApiToken(world.management, { name: "m", scopes: ALL })).token;
  salesToken = (await createApiToken(world.sales, { name: "s", scopes: ALL })).token;
  deliveryToken = (await createApiToken(world.delivery, { name: "d", scopes: ALL })).token;

  // A custom role that may open and change deals but has the deal value switched off everywhere (field rule hidden).
  const role = await createRole(world.management, {
    name: "Hidden Value Editor",
    permissionKeys: ["deals.view.all", "deals.edit.all", "deals.create", "activities.view", "activities.create", "companies.view", "contacts.view", "tasks.view.all", "leads.view.all", "quotes.create"],
    fieldRules: { "deal.value": "hidden" },
  });
  const { user, membership } = await createTestMembership(world.org.id, "SALES", "g301.hidden");
  await adminDb.membership.update({ where: { id: membership.id }, data: { roleId: role.id } });
  hiddenCtx = (await resolveActiveMembership(user.id, world.org.id))!;
  hiddenToken = (await createApiToken(hiddenCtx, { name: "h", scopes: ALL })).token;
});

describe("G3.01 API: a token never sees more than its owner, on every verb", () => {
  it("control: Management sees the sentinel value, so the scans below mean something", async () => {
    const res = await getDealRoute(apiRequest(`/api/v1/deals/${dealId}`, mgmtToken), params({ id: dealId }));
    expect(await res.text()).toContain(VALUE_1);
  });

  it("a role without deal-value rights gets no value from any read, list, timeline or search of the deal", async () => {
    for (const token of [salesToken, deliveryToken, hiddenToken]) {
      for (const url of [
        `/api/v1/deals?limit=100`,
        `/api/v1/deals?q=Review&limit=100`,
        `/api/v1/deals?includeArchived=true&limit=100`,
        `/api/v1/companies?limit=100`,
        `/api/v1/contacts?limit=100`,
        `/api/v1/leads?limit=100`,
        `/api/v1/tasks?dealId=${dealId}`,
        `/api/v1/activities?dealId=${dealId}`,
        `/api/v1/activities?companyId=${companyId}`,
      ]) {
        const res = await (url.startsWith("/api/v1/deals") ? listDealsRoute : url.startsWith("/api/v1/companies") ? listCompaniesRoute : url.startsWith("/api/v1/contacts") ? listContactsRoute : url.startsWith("/api/v1/leads") ? listLeadsRoute : url.startsWith("/api/v1/tasks") ? listTasksRoute : listActivitiesRoute)(apiRequest(url, token));
        expect(await res.text(), `${url}`).not.toMatch(LEAK);
      }
      const one = await getDealRoute(apiRequest(`/api/v1/deals/${dealId}`, token), params({ id: dealId }));
      expect(await one.text()).not.toMatch(LEAK);
    }
  });

  it("a role that may edit a deal but not see its value gets no value back from the write response either (PATCH)", async () => {
    for (const body of [{ notes: "touch" }, { expectedCloseDate: "2027-01-31" }, { currency: "KES" }, {}]) {
      const res = await patchDealRoute(apiRequest(`/api/v1/deals/${dealId}`, hiddenToken, { method: "PATCH", body }), params({ id: dealId }));
      expect([200, 400, 403]).toContain(res.status);
      expect(await res.text(), JSON.stringify(body)).not.toMatch(LEAK);
    }
  });

  it("a hidden-value role cannot read the value by filtering or sorting on it", async () => {
    for (const url of ["/api/v1/deals?sort=-value&limit=5", "/api/v1/deals?sort=value&limit=5", "/api/v1/deals?q=7654321", "/api/v1/deals?q=1111111"]) {
      const res = await listDealsRoute(apiRequest(url, hiddenToken));
      const text = await res.text();
      expect(text, url).not.toMatch(LEAK);
      if (url.includes("q=")) {
        // A search by the number must not even find the deal: finding it would confirm the value (an oracle).
        expect(res.status === 200 ? (JSON.parse(text) as { items: unknown[] }).items.length : 0, url).toBe(0);
      }
    }
  });

  it("a write-capable token owned by a restricted role is refused what the role is refused (Delivery cannot create leads or deals)", async () => {
    const leadStatusId = await getLeadStatusId(world.org.id);
    expect((await createLeadRoute(apiRequest("/api/v1/leads", deliveryToken, { method: "POST", body: { leadStatusId } }))).status).toBe(403);
  });

  it("a role change takes effect on the next request: a Management token whose owner becomes Delivery loses lead creation at once", async () => {
    const m2 = await createTestContext(world.org.id, "MANAGEMENT", "g301.demote");
    const tok = (await createApiToken(m2, { name: "demote", scopes: ALL })).token;
    const leadStatusId = await getLeadStatusId(world.org.id);
    expect((await createLeadRoute(apiRequest("/api/v1/leads", tok, { method: "POST", body: { leadStatusId } }))).status).toBe(200);
    const delivery = await adminDb.role.findFirstOrThrow({ where: { key: "DELIVERY", organizationId: null } });
    await adminDb.membership.update({ where: { id: m2.membershipId }, data: { roleId: delivery.id } });
    expect((await createLeadRoute(apiRequest("/api/v1/leads", tok, { method: "POST", body: { leadStatusId } }))).status).toBe(403);
  });

  it("an organisation moved below V2 stops every token at once (the public API is a V2 feature)", async () => {
    const w = await v2World();
    const tok = (await createApiToken(w.management, { name: "flag", scopes: ALL })).token;
    expect((await listCompaniesRoute(apiRequest("/api/v1/companies", tok))).status).toBe(200);
    await setOrganizationRelease(w.org.id, "v1.1");
    const res = await listCompaniesRoute(apiRequest("/api/v1/companies", tok));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.text()).not.toContain("companies");
  });

  it("revoking every token of a membership stops them on the next request", async () => {
    const m = await createTestContext(world.org.id, "MANAGEMENT", "g301.revoke");
    const a = (await createApiToken(m, { name: "a", scopes: ALL })).token;
    const b = (await createApiToken(m, { name: "b", scopes: ALL })).token;
    expect((await listCompaniesRoute(apiRequest("/api/v1/companies", a))).status).toBe(200);
    expect(await revokeTokensOfMembership(world.org.id, m.membershipId)).toBe(2);
    expect((await listCompaniesRoute(apiRequest("/api/v1/companies", a))).status).toBe(401);
    expect((await listCompaniesRoute(apiRequest("/api/v1/companies", b))).status).toBe(401);
  });
});

describe("G3.01 API: authentication details", () => {
  it("accepts only a Bearer header: not a query string, a cookie, a lower-case scheme variant with extra spaces, or Basic", async () => {
    const t = mgmtToken;
    const bare = (headers: Record<string, string>, url = "/api/v1/companies") => listCompaniesRoute(new Request(`http://localhost${url}`, { headers: { "x-forwarded-for": "198.51.100.77", ...headers } }));
    expect((await bare({}, `/api/v1/companies?token=${t}`)).status).toBe(401);
    expect((await bare({}, `/api/v1/companies?access_token=${t}`)).status).toBe(401);
    expect((await bare({ cookie: `token=${t}` })).status).toBe(401);
    expect((await bare({ authorization: `Basic ${Buffer.from(`x:${t}`).toString("base64")}` })).status).toBe(401);
    expect((await bare({ authorization: `Bearer  ${t} extra` })).status).toBe(401);
    expect((await bare({ authorization: `Bearer ${t.toUpperCase()}` })).status).toBe(401);
    expect((await bare({ authorization: `Bearer ${t}` })).status).toBe(200);
  });

  it("a token that differs in one character, in length, or only in the stored hash's input is refused with the same 401 body", async () => {
    const bodies = new Set<string>();
    for (const bad of [mgmtToken.slice(0, -1) + (mgmtToken.endsWith("A") ? "B" : "A"), mgmtToken.slice(0, -1), mgmtToken + "A", "fbk_", "fbk_" + "A".repeat(500), hashApiToken(mgmtToken)]) {
      const res = await listCompaniesRoute(apiRequest("/api/v1/companies", bad));
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      bodies.add(JSON.stringify({ code: body.code, message: body.message }));
    }
    expect(bodies.size).toBe(1);
  });

  it("the stored hash cannot be used as a credential (a database read does not become API access)", async () => {
    const row = await adminDb.apiToken.findFirstOrThrow({ where: { organizationId: world.org.id } });
    expect((await listCompaniesRoute(apiRequest("/api/v1/companies", row.tokenHash))).status).toBe(401);
    expect((await listCompaniesRoute(apiRequest("/api/v1/companies", `fbk_${row.tokenHash}`))).status).toBe(401);
  });

  it("tokens carry 256 bits of randomness and are all different", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) seen.add((await createApiToken(world.management, { name: `e${i}`, scopes: ["tasks:read"] }).catch(() => ({ token: `x${i}` }))).token);
    expect(seen.size).toBe(20);
    for (const t of seen) if (t.startsWith("fbk_")) expect(Buffer.from(t.slice(4), "base64url").length).toBe(32);
  });

  it("an error body never carries a stack, SQL or a driver message", async () => {
    const probes: Array<Promise<Response>> = [
      getDealRoute(apiRequest("/api/v1/deals/not-a-uuid'--", mgmtToken), params({ id: "not-a-uuid'--" })),
      getDealRoute(apiRequest(`/api/v1/deals/${"9".repeat(300)}`, mgmtToken), params({ id: "9".repeat(300) })),
      listDealsRoute(apiRequest("/api/v1/deals?cursor=%00%00", mgmtToken)),
      listDealsRoute(apiRequest("/api/v1/deals?cursor=" + "A".repeat(64), mgmtToken)),
      listDealsRoute(apiRequest("/api/v1/deals?limit=999999999999999999999", mgmtToken)),
      listDealsRoute(apiRequest("/api/v1/deals?limit=-1", mgmtToken)),
      listDealsRoute(apiRequest("/api/v1/deals?sort=value;DROP TABLE deals", mgmtToken)),
      listDealsRoute(apiRequest("/api/v1/deals?ownerMembershipId=' OR '1'='1", mgmtToken)),
      listDealsRoute(apiRequest("/api/v1/deals?pipelineStageId=%27%29%3B--", mgmtToken)),
      listDealsRoute(apiRequest("/api/v1/deals?customField[a'];--]=1", mgmtToken)),
      listCompaniesRoute(apiRequest("/api/v1/companies?q=%25%5C_%27", mgmtToken)),
      createCompanyRoute(new Request("http://localhost/api/v1/companies", { method: "POST", headers: { authorization: `Bearer ${mgmtToken}`, "content-type": "application/json", "x-forwarded-for": "198.51.100.5" }, body: "{not json" })),
    ];
    for (const res of await Promise.all(probes)) {
      expect(res.status).toBeLessThan(500);
      const text = await res.text();
      expect(text).not.toMatch(/prisma|PrismaClient|SELECT |INSERT |\bat .*\.(ts|js):\d+|node_modules|postgres|ECONN|Invalid `/i);
    }
  });
});

describe("G3.01 API: isolation, mass assignment and references into another organisation", () => {
  it("a body field naming another organisation or another organisation's member changes nothing and links nothing", async () => {
    const foreignCompany = await createCompany(other.management, { name: "Foreign Co" });
    const res = await createCompanyRoute(apiRequest("/api/v1/companies", mgmtToken, { method: "POST", body: { name: "Mass Assign Co", organizationId: other.org.id, id: "00000000-0000-4000-8000-0000000000aa" } }));
    expect(res.status).toBe(200);
    const created = (await res.json()) as { company: { id: string; organizationId: string } };
    expect(created.company.organizationId).toBe(world.org.id);
    expect(created.company.id).not.toBe("00000000-0000-4000-8000-0000000000aa");

    const foreignOwner = await adminDb.membership.findFirstOrThrow({ where: { organizationId: other.org.id } });
    const asOwner = await createCompanyRoute(apiRequest("/api/v1/companies", mgmtToken, { method: "POST", body: { name: "Foreign Owner Co", ownerMembershipId: foreignOwner.id } }));
    expect(asOwner.status).toBeGreaterThanOrEqual(400);
    expect(await adminDb.company.count({ where: { organizationId: world.org.id, ownerMembershipId: foreignOwner.id } })).toBe(0);

    // A contact, a task or a lead may not point at another organisation's company.
    const contact = await createContactRoute(apiRequest("/api/v1/contacts", mgmtToken, { method: "POST", body: { firstName: "X", companyId: foreignCompany.company.id } }));
    expect(contact.status).toBeGreaterThanOrEqual(400);
    const leadStatusId = await getLeadStatusId(world.org.id);
    const lead = await createLeadRoute(apiRequest("/api/v1/leads", mgmtToken, { method: "POST", body: { leadStatusId, companyId: foreignCompany.company.id } }));
    expect(lead.status).toBeGreaterThanOrEqual(400);
    const task = await createTaskRoute(apiRequest("/api/v1/tasks", mgmtToken, { method: "POST", body: { title: "t", companyId: foreignCompany.company.id } }));
    expect(task.status).toBeGreaterThanOrEqual(400);
    const patch = await patchCompanyRoute(apiRequest(`/api/v1/companies/${created.company.id}`, mgmtToken, { method: "PATCH", body: { ownerMembershipId: foreignOwner.id } }), params({ id: created.company.id }));
    expect(patch.status).toBeGreaterThanOrEqual(400);
  });

  it("an Idempotency-Key is private to the person: the same key from two people never replays the other's answer", async () => {
    const key = `shared-key-${Date.now()}-xyz`;
    const a = await createCompanyRoute(apiRequest("/api/v1/companies", mgmtToken, { method: "POST", body: { name: "Key A" }, headers: { "idempotency-key": key } }));
    const b = await createCompanyRoute(apiRequest("/api/v1/companies", salesToken, { method: "POST", body: { name: "Key B" }, headers: { "idempotency-key": key } }));
    const bOther = await createCompanyRoute(apiRequest("/api/v1/companies", (await createApiToken(other.management, { name: "o", scopes: ALL })).token, { method: "POST", body: { name: "Key C" }, headers: { "idempotency-key": key } }));
    expect(a.headers.get("idempotent-replayed")).toBeNull();
    expect(b.headers.get("idempotent-replayed")).toBeNull();
    expect(bOther.headers.get("idempotent-replayed")).toBeNull();
    expect(((await b.json()) as { company: { name: string } }).company.name).toBe("Key B");
    expect(((await bOther.json()) as { company: { name: string } }).company.name).toBe("Key C");
  });

  it("a task for a deal the token's owner cannot open is refused (no write into a record the owner cannot see)", async () => {
    const res = await createTaskRoute(apiRequest("/api/v1/tasks", deliveryToken, { method: "POST", body: { title: "sneak", dealId } }));
    expect([403, 404]).toContain(res.status);
  });
});

describe("G3.01 API: rate limiting and the client address", () => {
  beforeAll(() => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("control: the per-address limit counts the address the request carries", async () => {
    const ip = "203.0.113.201";
    await adminDb.authRateLimitAttempt.createMany({ data: Array.from({ length: API_RATE_LIMIT_PER_ADDRESS }, () => ({ action: "API_TOKEN" as const, scope: "ip", key: ip })) });
    const res = await listCompaniesRoute(new Request("http://localhost/api/v1/companies", { headers: { authorization: `Bearer ${mgmtToken}`, "x-forwarded-for": ip } }));
    expect(res.status).toBe(429);
  });

  // FINDING (Medium): authenticateApiToken reads the FIRST entry of X-Forwarded-For (src/auth/apiToken.ts clientAddress), which a caller chooses.
  // The rest of the application reads the entry TRUSTED_PROXY_HOPS places from the right (getClientIp), which a proxy appended and a caller cannot
  // set. With one trusted proxy in front, the real client is the last entry; a caller who prepends a fresh value to X-Forwarded-For on every
  // request gets a fresh per-address counter and is never limited.
  it.fails("the per-address limit cannot be dodged by putting a new first entry in X-Forwarded-For (proxy appended the real address last)", async () => {
    const real = "203.0.113.202";
    await adminDb.authRateLimitAttempt.createMany({ data: Array.from({ length: API_RATE_LIMIT_PER_ADDRESS }, () => ({ action: "API_TOKEN" as const, scope: "ip", key: real })) });
    const res = await listCompaniesRoute(new Request("http://localhost/api/v1/companies", { headers: { authorization: `Bearer ${mgmtToken}`, "x-forwarded-for": `6.6.6.${Math.floor(Math.random() * 200)}, ${real}` } }));
    expect(res.status).toBe(429);
  });

  it("a request with no address at all is not a free pass on the per-token limit", async () => {
    const t = (await createApiToken(world.management, { name: "noip", scopes: ["companies:read"] }));
    await adminDb.authRateLimitAttempt.createMany({ data: Array.from({ length: 120 }, () => ({ action: "API_TOKEN" as const, scope: "token", key: t.id })) });
    const res = await listCompaniesRoute(new Request("http://localhost/api/v1/companies", { headers: { authorization: `Bearer ${t.token}` } }));
    expect(res.status).toBe(429);
  });
});

describe("G3.01 API: scope edges", () => {
  // FINDING (Low): a token scoped only to `activities:read` reads the whole timeline of any company, contact, lead or deal its owner can open,
  // which carries notes, calls and the text of everything logged there, without holding `companies:read`, `contacts:read`, `leads:read` or
  // `deals:read`. Scopes are meant to narrow; here the activity scope is wider than its name.
  it.fails("a token with only activities:read cannot read the timeline of a deal or company it has no read scope for", async () => {
    const tok = (await createApiToken(world.management, { name: "acts", scopes: ["activities:read"] })).token;
    expect((await listActivitiesRoute(apiRequest(`/api/v1/activities?dealId=${dealId}`, tok))).status).toBe(403);
    expect((await listActivitiesRoute(apiRequest(`/api/v1/activities?companyId=${companyId}`, tok))).status).toBe(403);
  });

  it("a token cannot be created with a scope that does not exist, or with the empty set, or with more than 25 live tokens per person", async () => {
    await expect(createApiToken(world.sales, { name: "x", scopes: ["*"] })).rejects.toThrow(/Unknown scope/);
    await expect(createApiToken(world.sales, { name: "x", scopes: ["deals:admin"] })).rejects.toThrow(/Unknown scope/);
    await expect(createApiToken(world.sales, { name: "x", scopes: [] })).rejects.toThrow(/at least one/i);
    const m = await createTestContext(world.org.id, "SALES", "g301.cap");
    for (let i = 0; i < 25; i++) await createApiToken(m, { name: `t${i}`, scopes: ["tasks:read"] });
    await expect(createApiToken(m, { name: "t26", scopes: ["tasks:read"] })).rejects.toThrow(/25 active/);
  });

  it("a token is bound to its organisation: the same person's token in organisation A never reads organisation B", async () => {
    const stranger = await createCompany(other.management, { name: "Org B Only Co" });
    const text = await (await listCompaniesRoute(apiRequest("/api/v1/companies?limit=100&includeArchived=true", mgmtToken))).text();
    expect(text).not.toContain(stranger.company.id);
    expect(text).not.toContain("Org B Only Co");
  });

  it("a delivery created through the API for a task is stamped with the token owner's organisation, never another's", async () => {
    const t = await createTask(world.management, { title: "scoped task" });
    expect((t as { organizationId: string }).organizationId).toBe(world.org.id);
  });
});
