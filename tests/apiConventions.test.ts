import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { requirePermission } from "../src/auth/context";
import {
  ForbiddenError,
  NoActiveMembershipError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  ValidationError,
} from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { buildOpenApiDocument, OPERATIONS } from "../src/api/openapi";
import { ErrorEnvelopeSchema } from "../src/api/dto/common";
import { DealSchema } from "../src/api/dto/deals";
import { ListLeadsResponseSchema } from "../src/api/dto/leads";
import { respond } from "../src/api/respond";
import { ApiError, buildErrorResponse, newRequestId } from "../src/lib/apiErrors";
import { parseFilters, parseSort } from "../src/lib/listQuery";
import { decodeCursor, encodeCursor } from "../src/lib/pagination";
import * as dealService from "../src/services/dealService";
import * as leadService from "../src/services/leadService";
import {
  createTestContext,
  createTestOrganization,
  getLeadStatusId,
  getPipelineStageId,
  getServiceId,
} from "./helpers/fixtures";

// Route handlers resolve the caller from the session cookie; these tests
// drive the real handlers as whoever `current.ctx` says.
const current: { ctx: AuthContext | null } = { ctx: null };
vi.mock("../src/auth/requestContext", () => ({
  resolveRequestContext: async () => {
    if (!current.ctx) {
      const { UnauthorizedError } = await import("../src/auth/errors");
      throw new UnauthorizedError();
    }
    return current.ctx;
  },
}));

import * as dealRoute from "../src/app/api/orgs/[orgSlug]/deals/[dealId]/route";
import * as leadsRoute from "../src/app/api/orgs/[orgSlug]/leads/route";

/**
 * FIG-1014 (B0.06): the API conventions -- one error envelope, the standard
 * list query, Zod DTOs checked against real responses, idempotent creates --
 * and the OpenAPI document generated from the same schemas.
 */

const BASE = "http://localhost/api/orgs/x";
const leadsParams = { params: Promise.resolve({ orgSlug: "x" }) };

async function setup() {
  const org = await createTestOrganization("ApiConv");
  const mgmt = await createTestContext(org.id, "MANAGEMENT", "ac.mgmt");
  const sales = await createTestContext(org.id, "SALES", "ac.sales");
  const delivery = await createTestContext(org.id, "DELIVERY", "ac.delivery");
  const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "ac.technical");
  const leadStatusId = await getLeadStatusId(org.id);
  return { org, mgmt, sales, delivery, technical, leadStatusId };
}

async function json(res: Response) {
  return res.json();
}

const get = (qs = "") =>
  leadsRoute.GET(new Request(`${BASE}/leads${qs}`), leadsParams);
const post = (body: unknown, key?: string) =>
  leadsRoute.POST(
    new Request(`${BASE}/leads`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { "idempotency-key": key } : {}),
      },
      body: JSON.stringify(body),
    }),
    leadsParams,
  );

beforeEach(() => {
  current.ctx = null;
});

describe("error envelope", () => {
  it("maps every typed error to one shape with a code, message, fieldErrors and requestId", async () => {
    const cases: [unknown, number, string][] = [
      [new UnauthorizedError(), 401, "UNAUTHORIZED"],
      [new NoActiveMembershipError("acme"), 403, "NO_ACTIVE_MEMBERSHIP"],
      [new NotFoundError("Lead", "abc"), 404, "NOT_FOUND"],
      [new ValidationError("bad"), 400, "VALIDATION_FAILED"],
      [new RateLimitedError(), 429, "RATE_LIMITED"],
      [new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "busy"), 409, "IDEMPOTENCY_IN_PROGRESS"],
      [new Error("db exploded: password=hunter2"), 500, "INTERNAL_ERROR"],
    ];
    for (const [err, status, code] of cases) {
      const { status: s, body } = await buildErrorResponse(err, "req-12345678");
      expect(s).toBe(status);
      expect(body.code).toBe(code);
      expect(body.error).toBe(body.message);
      expect(body.requestId).toBe("req-12345678");
      expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
    }
  });

  it("never leaks the cause of an unexpected error", async () => {
    const { body } = await buildErrorResponse(new Error("password=hunter2"), "req-12345678");
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(body.message).toBe("Internal server error.");
  });

  it("returns field errors (and the old `issues` alias) for a validation failure", async () => {
    const err = new ValidationError("Validation failed.", [
      { path: "name", message: "Required" },
    ]);
    const { body } = await buildErrorResponse(err, "req-12345678");
    expect(body.fieldErrors).toEqual([{ path: "name", message: "Required" }]);
    expect(body.issues).toEqual(body.fieldErrors);
  });

  it("explains a denial: the caller's role, the roles that own the area, and who to ask", async () => {
    const { sales } = await setup();
    let denied: unknown;
    try {
      requirePermission(sales, "organization.manage_settings");
    } catch (err) {
      denied = err;
    }
    const { status, body } = await buildErrorResponse(denied, "req-12345678");
    expect(status).toBe(403);
    expect(body.denial).toEqual({
      yourRole: "Sales",
      ownerRoles: ["Management"],
      whoToAsk: [expect.any(String)],
    });
    expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
  });

  it("lists every role that could do an own-or-all action", async () => {
    const { delivery } = await setup();
    let denied: unknown;
    try {
      requirePermission(delivery, "leads.view.all");
    } catch (err) {
      denied = err;
    }
    const { body } = await buildErrorResponse(denied, "req-12345678");
    expect(body.denial?.yourRole).toBe("Delivery");
    expect(body.denial?.ownerRoles).toContain("Management");
  });

  it("builds a denial even for a permission string that is not a key, with no roles listed", async () => {
    const { body } = await buildErrorResponse(
      new ForbiddenError("tasks.assign.any, or being this task's assignee/creator"),
      "req-12345678",
    );
    expect(body.code).toBe("FORBIDDEN");
    expect(body.denial?.ownerRoles).toEqual([]);
    expect(body.denial?.whoToAsk).toEqual([]);
  });

  it("echoes a safe caller request id and replaces an unsafe one", () => {
    expect(newRequestId("client-req-0001")).toBe("client-req-0001");
    const fresh = newRequestId("bad id with spaces\nand newline");
    expect(fresh).toMatch(/^[0-9a-f-]{36}$/);
    expect(newRequestId(null)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("comes back from a real route as the envelope, with a request id header", async () => {
    const res = await get();
    expect(res.status).toBe(401);
    const body = await json(res);
    expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.code).toBe("UNAUTHORIZED");
    expect(res.headers.get("x-request-id")).toBe(body.requestId);
  });

  it("returns a validation failure from a route with fieldErrors", async () => {
    const { mgmt } = await setup();
    current.ctx = mgmt;
    const res = await post({});
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.fieldErrors[0].path).toBe("leadStatusId");
  });
});

describe("standard list query", () => {
  it("pages with page/pageSize, the limit alias and an opaque cursor, and says when it is the last page", async () => {
    const { mgmt, leadStatusId } = await setup();
    current.ctx = mgmt;
    for (let i = 0; i < 5; i++) await leadService.createLead(mgmt, { leadStatusId });

    const first = await json(await get("?limit=2"));
    expect(first).toMatchObject({ page: 1, pageSize: 2, total: 5, pageCount: 3 });
    expect(first.nextCursor).toBeTruthy();

    const second = await json(await get(`?limit=2&cursor=${first.nextCursor}`));
    expect(second.page).toBe(2);
    const third = await json(await get(`?pageSize=2&cursor=${second.nextCursor}`));
    expect(third.page).toBe(3);
    expect(third.items).toHaveLength(1);
    expect(third.nextCursor).toBeNull();

    const ids = [...first.items, ...second.items, ...third.items].map((l: { id: string }) => l.id);
    expect(new Set(ids).size).toBe(5);

    // pageSize wins over limit; a junk cursor falls back to page 1.
    expect((await json(await get("?pageSize=3&limit=1"))).pageSize).toBe(3);
    expect((await json(await get("?cursor=garbage"))).page).toBe(1);
  });

  it("sorts ascending or descending and rejects a field it cannot sort by", async () => {
    const { mgmt, leadStatusId } = await setup();
    current.ctx = mgmt;
    const a = (await leadService.createLead(mgmt, { leadStatusId })).lead;
    await new Promise((r) => setTimeout(r, 15));
    const b = (await leadService.createLead(mgmt, { leadStatusId })).lead;

    const asc = await json(await get("?sort=createdAt"));
    expect(asc.items.map((l: { id: string }) => l.id)).toEqual([a.id, b.id]);
    const desc = await json(await get("?sort=-createdAt"));
    expect(desc.items.map((l: { id: string }) => l.id)).toEqual([b.id, a.id]);

    const bad = await get("?sort=notes");
    expect(bad.status).toBe(400);
    const body = await json(bad);
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.fieldErrors[0].path).toBe("sort");
  });

  it("has sort and filter[...] parsers that reject unknown names", () => {
    expect(parseSort("-name", ["name", "createdAt"] as const)).toEqual({
      field: "name",
      direction: "desc",
    });
    expect(parseSort(undefined, ["name"] as const)).toBeUndefined();
    expect(() => parseSort("x", ["name"] as const)).toThrow(ValidationError);
    const params = new URLSearchParams("filter[status]=NEW&q=abc&filter[owner]=me");
    expect(parseFilters(params, ["status", "owner"] as const)).toEqual({
      status: "NEW",
      owner: "me",
    });
    expect(() => parseFilters(params, ["status"] as const)).toThrow(ValidationError);
  });

  it("round-trips cursors and ignores tampered ones", () => {
    expect(decodeCursor(encodeCursor(7))).toBe(7);
    expect(decodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor("not-base64-!!")).toBeUndefined();
    expect(decodeCursor(Buffer.from("p:0").toString("base64url"))).toBeUndefined();
  });
});

describe("contract: leads list", () => {
  it("returns exactly the documented shape, with archived, masked and scope on every row", async () => {
    const { mgmt, sales, leadStatusId } = await setup();
    await leadService.createLead(sales, { leadStatusId });
    await leadService.createLead(mgmt, { leadStatusId });

    current.ctx = mgmt;
    const asMgmt = await get();
    expect(asMgmt.status).toBe(200);
    const body = await json(asMgmt);
    expect(ListLeadsResponseSchema.safeParse(body).success).toBe(true);
    expect(body.items.every((l: { scope: string }) => l.scope === "organisation")).toBe(true);
    expect(body.items.every((l: { archived: boolean; masked: boolean }) => !l.archived && !l.masked)).toBe(true);
    expect(asMgmt.headers.get("x-request-id")).toBeTruthy();

    current.ctx = sales;
    const asSales = await json(await get());
    expect(ListLeadsResponseSchema.safeParse(asSales).success).toBe(true);
    expect(asSales.total).toBe(1);
    expect(asSales.items[0].scope).toBe("own");
  });

  it("flags an archived lead", async () => {
    const { mgmt, leadStatusId } = await setup();
    const { lead } = await leadService.createLead(mgmt, { leadStatusId });
    await adminDb.lead.update({ where: { id: lead.id }, data: { archivedAt: new Date() } });
    current.ctx = mgmt;
    const body = await json(await get("?includeArchived=true"));
    expect(body.items[0]).toMatchObject({ archived: true, masked: false });
  });

  it("fails loudly when a response drifts from its schema", async () => {
    const { mgmt, leadStatusId } = await setup();
    await leadService.createLead(mgmt, { leadStatusId });
    current.ctx = mgmt;

    const real = leadService.listLeadsPage;
    const spy = vi.spyOn(leadService, "listLeadsPage");
    const page = await real(mgmt, {}, {});

    // A field the schema does not know about.
    spy.mockResolvedValueOnce({
      ...page,
      items: page.items.map((l) => ({ ...l, surprise: 1 })),
    });
    expect((await get()).status).toBe(500);

    // A field the schema requires, missing.
    spy.mockResolvedValueOnce({
      ...page,
      items: page.items.map(({ leadStatusId: _drop, ...rest }) => rest as typeof page.items[number]),
    });
    expect((await get()).status).toBe(500);

    // A field of the wrong type.
    spy.mockResolvedValueOnce({
      ...page,
      items: page.items.map((l) => ({ ...l, temperature: "LUKEWARM" as never })),
    });
    expect((await get()).status).toBe(500);

    spy.mockRestore();
    expect((await get()).status).toBe(200);
  });

  it("checks a response by its wire form and throws a readable list of what drifted", () => {
    expect(() => respond(ListLeadsResponseSchema, { items: "nope" })).toThrow(
      /does not match its schema/,
    );
  });
});

describe("contract: deal detail", () => {
  async function dealSetup() {
    const s = await setup();
    const { company } = await (await import("../src/services/companyService")).createCompany(s.mgmt, {
      name: "Contract Co",
    });
    const deal = await dealService.createDeal(s.mgmt, {
      companyId: company.id,
      pipelineStageId: await getPipelineStageId(s.org.id),
      serviceId: await getServiceId(s.org.id),
      value: 1234.5,
    });
    // Delivery and Finance see won deals only (B1.03), so the contract tests
    // for those roles need a won deal; `deal` stays open for the others.
    const openDeal = await dealService.createDeal(s.mgmt, {
      companyId: company.id,
      pipelineStageId: await getPipelineStageId(s.org.id),
      serviceId: await getServiceId(s.org.id),
      value: 99,
    });
    await dealService.updateDeal(s.mgmt, openDeal.id, {
      pipelineStageId: await getPipelineStageId(s.org.id, "CLOSED_WON"),
    });
    const wonDeal = openDeal;
    return { ...s, deal, wonDeal };
  }
  const getDeal = (id: string) =>
    dealRoute.GET(new Request(`${BASE}/deals/${id}`), {
      params: Promise.resolve({ orgSlug: "x", dealId: id }),
    });

  it("returns exactly the documented shape with the value for a role that may see it", async () => {
    const { mgmt, deal } = await dealSetup();
    current.ctx = mgmt;
    const res = await getDeal(deal.id);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(DealSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      value: "1234.5",
      masked: false,
      valueMasked: false,
      archived: false,
      scope: "organisation",
    });
  });

  it("masks the value and marks the record read-only for a role without the value permission", async () => {
    const { delivery, wonDeal } = await dealSetup();
    current.ctx = delivery;
    const body = await json(await getDeal(wonDeal.id));
    expect(DealSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      value: null,
      masked: true,
      valueMasked: true,
      scope: "read-only",
      provisional: true,
    });
  });

  it("explains the denial for a role that cannot use deals at all", async () => {
    const { technical, deal } = await dealSetup();
    current.ctx = technical;
    const res = await getDeal(deal.id);
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body.denial.yourRole).toBe("Restricted Technical");
    expect(body.denial.ownerRoles).toEqual(expect.arrayContaining(["Management", "Sales"]));
    expect(body.denial.whoToAsk.length).toBeGreaterThan(0);
  });

  it("answers 404, not 403, for a deal another salesperson owns (no existence leak)", async () => {
    const { sales, deal } = await dealSetup();
    current.ctx = sales;
    const res = await getDeal(deal.id);
    expect(res.status).toBe(404);
    expect((await json(res)).code).toBe("NOT_FOUND");
  });

  it("is a 404 envelope for a deal that does not exist", async () => {
    const { mgmt } = await dealSetup();
    current.ctx = mgmt;
    const res = await getDeal("00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
    expect((await json(res)).code).toBe("NOT_FOUND");
  });
});

describe("idempotency keys", () => {
  const KEY = "key-aaaaaaaa-0001";

  it("creates once for a repeated key and replays the first response", async () => {
    const { mgmt, org, leadStatusId } = await setup();
    current.ctx = mgmt;
    const first = await post({ leadStatusId }, KEY);
    expect(first.status).toBe(200);
    expect(first.headers.get("idempotent-replayed")).toBeNull();
    const firstBody = await json(first);

    const second = await post({ leadStatusId }, KEY);
    expect(second.status).toBe(200);
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect((await json(second)).lead.id).toBe(firstBody.lead.id);

    expect(await adminDb.lead.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it("creates every time when no key is sent", async () => {
    const { mgmt, org, leadStatusId } = await setup();
    current.ctx = mgmt;
    await post({ leadStatusId });
    await post({ leadStatusId });
    expect(await adminDb.lead.count({ where: { organizationId: org.id } })).toBe(2);
  });

  it("refuses a key reused for a different request", async () => {
    const { mgmt, leadStatusId } = await setup();
    current.ctx = mgmt;
    await post({ leadStatusId }, KEY);
    const res = await post({ leadStatusId, temperature: "HOT" }, KEY);
    expect(res.status).toBe(422);
    expect((await json(res)).code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("rejects a malformed key", async () => {
    const { mgmt, leadStatusId } = await setup();
    current.ctx = mgmt;
    for (const key of ["short", "has space in it 123", "x".repeat(201)]) {
      const res = await post({ leadStatusId }, key);
      expect(res.status).toBe(400);
      expect((await json(res)).fieldErrors[0].path).toBe("Idempotency-Key");
    }
  });

  it("frees the key when the request fails, so the retry runs again", async () => {
    const { sales, mgmt, org, leadStatusId } = await setup();
    current.ctx = sales;
    // Sales may not create a lead owned by someone else.
    const body = { leadStatusId, ownerMembershipId: mgmt.membershipId };
    expect((await post(body, KEY)).status).toBe(403);
    expect((await post(body, KEY)).status).toBe(403);
    const rows = await withOrgContext(org.id, (tx) => tx.idempotencyKey.count());
    expect(rows).toBe(0);
  });

  it("lets a stuck claim be retaken after a minute but not before", async () => {
    const { mgmt, org, leadStatusId } = await setup();
    current.ctx = mgmt;
    const hash = "0".repeat(64);
    const stuck = (createdAt: Date) =>
      adminDb.idempotencyKey.create({
        data: {
          organizationId: org.id,
          membershipId: mgmt.membershipId,
          key: KEY,
          method: "POST",
          path: "/api/orgs/x/leads",
          requestHash: hash,
          createdAt,
        },
      });

    // A live claim with a matching request blocks with a 409.
    const live = await stuck(new Date());
    const { createHash } = await import("crypto");
    const requestHash = createHash("sha256")
      .update(JSON.stringify(["POST", "/api/orgs/x/leads", { leadStatusId }]))
      .digest("hex");
    await adminDb.idempotencyKey.update({ where: { id: live.id }, data: { requestHash } });
    const busy = await post({ leadStatusId }, KEY);
    expect(busy.status).toBe(409);
    expect((await json(busy)).code).toBe("IDEMPOTENCY_IN_PROGRESS");

    // Once it is stale (the first request died) the retry takes over.
    await adminDb.idempotencyKey.update({
      where: { id: live.id },
      data: { createdAt: new Date(Date.now() - 5 * 60_000) },
    });
    expect((await post({ leadStatusId }, KEY)).status).toBe(200);
    expect(await adminDb.lead.count({ where: { organizationId: org.id } })).toBe(1);
  });

  it("runs one of two simultaneous requests with the same key", async () => {
    const { mgmt, org, leadStatusId } = await setup();
    current.ctx = mgmt;
    const results = await Promise.all([
      post({ leadStatusId }, KEY),
      post({ leadStatusId }, KEY),
    ]);
    expect(await adminDb.lead.count({ where: { organizationId: org.id } })).toBe(1);
    expect(results.map((r) => r.status).sort()).toSatisfy((s: number[]) =>
      s.every((x) => x === 200 || x === 409),
    );
    expect(results.some((r) => r.status === 200)).toBe(true);
  });

  it("scopes keys to the person and organization and never shows another organization's rows", async () => {
    const a = await setup();
    const b = await setup();
    current.ctx = a.mgmt;
    await post({ leadStatusId: a.leadStatusId }, KEY);
    // The same key text in another organization is its own request.
    current.ctx = b.mgmt;
    const other = await post({ leadStatusId: b.leadStatusId }, KEY);
    expect(other.headers.get("idempotent-replayed")).toBeNull();
    expect(await adminDb.lead.count({ where: { organizationId: b.org.id } })).toBe(1);
    // A different person in the same organization is also independent.
    current.ctx = a.sales;
    const peer = await post({ leadStatusId: a.leadStatusId }, KEY);
    expect(peer.headers.get("idempotent-replayed")).toBeNull();

    // Row-level security: organization B cannot read organization A's keys.
    const seenByB = await withOrgContext(b.org.id, (tx) =>
      tx.idempotencyKey.findMany({ where: { organizationId: a.org.id } }),
    );
    expect(seenByB).toEqual([]);
    const own = await withOrgContext(a.org.id, (tx) => tx.idempotencyKey.count());
    expect(own).toBe(2);
  });
});

describe("OpenAPI document", () => {
  const doc = buildOpenApiDocument();

  it("is a 3.1 document with one operation per converted route and unique operation ids", () => {
    expect(doc.openapi).toBe("3.1.0");
    const ids = Object.values(doc.paths).flatMap((p) =>
      Object.values(p as Record<string, { operationId: string }>).map((o) => o.operationId),
    );
    expect(ids).toHaveLength(OPERATIONS.length);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/api/orgs/{orgSlug}/leads", "/api/orgs/{orgSlug}/deals/{dealId}"]),
    );
  });

  it("describes the standard list parameters, the idempotency header and the error envelope", () => {
    const paths = doc.paths as Record<string, Record<string, any>>;
    const list = paths["/api/orgs/{orgSlug}/leads"]!.get;
    const names = list.parameters.map((p: { name: string }) => p.name);
    expect(names).toEqual(
      expect.arrayContaining(["orgSlug", "q", "page", "pageSize", "limit", "cursor", "sort"]),
    );
    const create = paths["/api/orgs/{orgSlug}/leads"]!.post;
    expect(create.parameters.map((p: { name: string }) => p.name)).toContain("Idempotency-Key");
    expect(create.responses["422"]).toBeDefined();
    expect(list.responses["403"].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/ErrorEnvelope",
    );
    const envelope = doc.components.schemas.ErrorEnvelope as { properties: Record<string, unknown> };
    expect(envelope.properties.denial).toBeDefined();
  });

  it("is generated from the same schemas: a strict response schema is closed, and the deal schema has the standard record fields", () => {
    const paths = doc.paths as Record<string, Record<string, any>>;
    const deal = paths["/api/orgs/{orgSlug}/deals/{dealId}"]!.get.responses["200"].content[
      "application/json"
    ].schema;
    expect(deal.additionalProperties).toBe(false);
    expect(Object.keys(deal.properties)).toEqual(
      expect.arrayContaining(["archived", "masked", "scope", "valueMasked"]),
    );
    expect(deal.properties.scope.enum).toEqual(["own", "organisation", "read-only"]);
  });

  it("survives a JSON round trip (it is what CI exports)", () => {
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });
});
