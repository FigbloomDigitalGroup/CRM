/**
 * Calls a route handler the way a client with a valid request would: the first attempt is empty, and when the route answers 400 the
 * schema it validated against (captured by the `validation` mock) is used to build a body and query that pass, then the call is
 * repeated. That gets every route past input validation to the permission and record checks, which is what the suites are about.
 */
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { World } from "./world";
import { idFor } from "./world";
import { invoke, type DiscoveredRoute, type HttpMethod } from "./routeHarness";
import { queryFor, sampleFor, type Hints } from "./sampleBody";
import { captured } from "./validationCapture";
import { REQUEST_OVERRIDES } from "./routeRequests";

export { captured } from "./validationCapture";

/** Ids a request body may name, taken from the world (a lead's `ownerMembershipId` is a real member, a deal's `pipelineStageId` a real stage). */
export async function bodyHints(world: World): Promise<Hints> {
  const { adminDb } = await import("../../src/db/adminClient");
  const org = world.organization.id;
  const [stage, status, source, service] = await Promise.all([
    adminDb.pipelineStage.findFirst({ where: { organizationId: org, isWon: false, isLost: false }, orderBy: { sequence: "asc" } }),
    adminDb.leadStatus.findFirst({ where: { organizationId: org, key: "NEW" } }),
    adminDb.leadSource.findFirst({ where: { organizationId: org } }),
    adminDb.service.findFirst({ where: { organizationId: org } }),
  ]);
  const hints: Hints = {};
  for (const [name, value] of Object.entries(world.ids)) if (name !== "orgSlug" && name !== "serviceId") hints[name] = value;
  Object.assign(hints, {
    ownerMembershipId: world.ctx.SALES.membershipId,
    assigneeMembershipId: world.ctx.SALES.membershipId,
    membershipId: world.ctx.SALES.membershipId,
    intoId: world.ids.tagId ?? "",
    ...(stage ? { pipelineStageId: stage.id, stageId: stage.id, toStageId: stage.id } : {}),
    ...(status ? { leadStatusId: status.id, statusId: status.id } : {}),
    ...(source ? { leadSourceId: source.id, sourceId: source.id } : {}),
    ...(service ? { serviceId: service.id, serviceInterestId: service.id } : {}),
  });
  return hints;
}

const MULTIPART = new Set([
  "POST /api/orgs/{orgSlug}/imports",
  "POST /api/orgs/{orgSlug}/leads/import",
  "POST /api/orgs/{orgSlug}/contacts/import",
  "POST /api/orgs/{orgSlug}/companies/import",
  "POST /api/orgs/{orgSlug}/data-migration/sessions/{sessionId}/file",
]);

function csvForm(): FormData {
  const form = new FormData();
  form.set("file", new File(["name,email\nAcme Ltd,acme@example.test\n"], "rows.csv", { type: "text/csv" }));
  form.set("entity", "COMPANY");
  return form;
}

export interface Walk {
  status: number;
  code: string | null;
  json: any;
  text: string;
  /** True when the request had to be built from the route's schema to get past validation. */
  synthesized: boolean;
  /** The schemas the route validated against, when the call got far enough to reach them. */
  bodySchema?: z.ZodType;
  querySchema?: z.ZodType;
}

export async function walkRoute(route: DiscoveredRoute, method: HttpMethod, values: Record<string, string>, hints: Hints, extraHeaders: Record<string, string> = {}): Promise<Walk> {
  const headers = { ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}), ...extraHeaders };
  captured.body = undefined;
  captured.query = undefined;
  if (MULTIPART.has(`${method} ${route.path}`)) {
    const res = await invoke(route, method, values, { form: csvForm(), headers: extraHeaders });
    return { status: res.status, code: res.code, json: res.json, text: res.text, synthesized: true };
  }
  const override = REQUEST_OVERRIDES[`${method} ${route.path}`]?.(hints);
  let res = await invoke(route, method, values, { headers, ...(override ?? {}) });
  const bodySchema = captured.body;
  const querySchema = captured.query;
  if (res.status !== 400 || (!bodySchema && !querySchema)) {
    return { status: res.status, code: res.code, json: res.json, text: res.text, synthesized: false, bodySchema, querySchema };
  }
  for (const all of [false, true]) {
    const body = bodySchema ? sampleFor(bodySchema, hints, all) : undefined;
    const query = querySchema ? queryFor(querySchema, hints, all) : "";
    res = await invoke(route, method, values, { body, query, headers: { ...headers, "idempotency-key": randomUUID() } });
    if (res.status !== 400) break;
  }
  return { status: res.status, code: res.code, json: res.json, text: res.text, synthesized: true, bodySchema, querySchema };
}

export { idFor };
