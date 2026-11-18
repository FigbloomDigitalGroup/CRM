import { z } from "zod";
import { CreateLeadBodySchema, ListLeadsQuerySchema } from "./dto/leads";
import * as S from "./publicApi/schemas";

/**
 * The operations of Lane C of M17 (FIG-805 public API with API tokens, FIG-804 webhooks), for the V2 document built by
 * `src/api/publicApi/openapi.ts`, and the routes they add, which are not in the frozen V1 contract (`NOT_IN_V1_CONTRACT`).
 */

export interface V2Operation {
  method: "get" | "post" | "patch" | "delete";
  path: string;
  operationId: string;
  summary: string;
  tag: string;
  /** `bearerToken` for the public API; `sessionCookie` for the management routes the application's own pages call. */
  security: "bearerToken" | "sessionCookie";
  /** The token scope a public call needs. */
  scope?: string;
  query?: z.ZodObject;
  body?: z.ZodType;
  response: z.ZodType;
  /** Notes on who may call it, shown as the description. */
  note?: string;
  idempotent?: boolean;
  errors: (400 | 401 | 403 | 404 | 409 | 422 | 429)[];
}

const ORG = "/api/orgs/{orgSlug}";
const V1 = "/api/v1";
const ERR_READ: V2Operation["errors"] = [401, 403, 404, 429];
const ERR_WRITE: V2Operation["errors"] = [400, 401, 403, 404, 409, 422, 429];

function publicEntity(entity: string, label: string, schemas: { list: z.ZodObject; create: z.ZodType; update: z.ZodType }, idempotent = true): V2Operation[] {
  const tag = "Public API";
  const ops: V2Operation[] = [
    { method: "get", path: `${V1}/${entity}`, operationId: `publicList${label}`, summary: `List ${entity}, one page at a time`, tag, security: "bearerToken", scope: `${entity}:read`, query: schemas.list, response: S.RecordPage, errors: ERR_READ },
    { method: "post", path: `${V1}/${entity}`, operationId: `publicCreate${label}`, summary: `Create a ${label.toLowerCase()}`, tag, security: "bearerToken", scope: `${entity}:write`, body: schemas.create, response: z.looseObject({}), idempotent, errors: ERR_WRITE },
  ];
  if (entity !== "activities") {
    ops.push(
      { method: "get", path: `${V1}/${entity}/{id}`, operationId: `publicGet${label}`, summary: `Read one ${label.toLowerCase()}`, tag, security: "bearerToken", scope: `${entity}:read`, response: S.RecordResponse, errors: ERR_READ },
      { method: "patch", path: `${V1}/${entity}/{id}`, operationId: `publicUpdate${label}`, summary: `Change a ${label.toLowerCase()}`, tag, security: "bearerToken", scope: `${entity}:write`, body: schemas.update, response: z.looseObject({}), errors: ERR_WRITE },
    );
  }
  return ops;
}

export const V2_OPERATIONS_C: V2Operation[] = [
  ...publicEntity("companies", "Company", { list: S.ListCompaniesQuery, create: S.CreateCompanyBody, update: S.UpdateCompanyBody }),
  ...publicEntity("contacts", "Contact", { list: S.ListContactsQuery, create: S.CreateContactBody, update: S.UpdateContactBody }),
  ...publicEntity("leads", "Lead", { list: ListLeadsQuerySchema.extend(S.pageQuery), create: CreateLeadBodySchema, update: S.UpdateLeadBody }),
  ...publicEntity("deals", "Deal", { list: S.ListDealsQuery, create: S.CreateDealBody, update: S.UpdateDealBody }),
  ...publicEntity("tasks", "Task", { list: S.ListTasksQuery, create: S.CreateTaskBody, update: S.UpdateTaskBody }),
  ...publicEntity("activities", "Activity", { list: S.ListActivitiesQuery, create: S.CreateActivityBody, update: z.object({}) }),

  { method: "get", path: `${ORG}/api-tokens`, operationId: "listApiTokens", summary: "List API tokens (your own; every token for Management)", tag: "API tokens", security: "sessionCookie", response: S.ApiTokenList, errors: [401, 403, 429] },
  { method: "post", path: `${ORG}/api-tokens`, operationId: "createApiToken", summary: "Create an API token. The token is in this response only.", tag: "API tokens", security: "sessionCookie", body: S.CreateApiTokenBody, response: S.CreatedApiToken, errors: [400, 401, 403, 422] },
  { method: "delete", path: `${ORG}/api-tokens/{tokenId}`, operationId: "revokeApiToken", summary: "Revoke an API token", tag: "API tokens", security: "sessionCookie", response: S.ApiTokenView, errors: [401, 403, 404] },

  { method: "get", path: `${ORG}/webhooks`, operationId: "listWebhooks", summary: "List webhook endpoints and the events that can be chosen", tag: "Webhooks", security: "sessionCookie", note: "Management only.", response: S.WebhookList, errors: [401, 403] },
  { method: "post", path: `${ORG}/webhooks`, operationId: "createWebhook", summary: "Register a webhook endpoint. The signing secret is in this response only.", tag: "Webhooks", security: "sessionCookie", note: "Management only. The address must be a public https address.", body: S.CreateWebhookBody, response: S.WebhookWithSecret, errors: [400, 401, 403, 422] },
  { method: "get", path: `${ORG}/webhooks/{endpointId}`, operationId: "getWebhook", summary: "Read one webhook endpoint", tag: "Webhooks", security: "sessionCookie", note: "Management only.", response: S.WebhookView, errors: [401, 403, 404] },
  { method: "patch", path: `${ORG}/webhooks/{endpointId}`, operationId: "updateWebhook", summary: "Change an endpoint's address, events or status (resume or pause)", tag: "Webhooks", security: "sessionCookie", note: "Management only.", body: S.UpdateWebhookBody, response: S.WebhookView, errors: [400, 401, 403, 404, 422] },
  { method: "delete", path: `${ORG}/webhooks/{endpointId}`, operationId: "deleteWebhook", summary: "Remove a webhook endpoint and its delivery log", tag: "Webhooks", security: "sessionCookie", note: "Management only.", response: z.strictObject({ id: z.string(), deleted: z.literal(true) }), errors: [401, 403, 404] },
  { method: "post", path: `${ORG}/webhooks/{endpointId}/rotate-secret`, operationId: "rotateWebhookSecret", summary: "Rotate the signing secret. The new secret is in this response only.", tag: "Webhooks", security: "sessionCookie", note: "Management only. The old secret stops working at once.", response: S.WebhookWithSecret, errors: [401, 403, 404] },
  { method: "post", path: `${ORG}/webhooks/{endpointId}/test`, operationId: "testWebhook", summary: "Queue a signed test event (webhook.ping)", tag: "Webhooks", security: "sessionCookie", note: "Management only.", response: z.strictObject({ deliveryId: z.string(), eventId: z.string() }), errors: [401, 403, 404] },
  { method: "get", path: `${ORG}/webhooks/{endpointId}/deliveries`, operationId: "listWebhookDeliveries", summary: "The delivery log of an endpoint", tag: "Webhooks", security: "sessionCookie", note: "Management only. Query: status (PENDING, DELIVERED, DEAD), limit.", response: S.WebhookDeliveryList, errors: [401, 403, 404] },
  { method: "post", path: `${ORG}/webhooks/{endpointId}/deliveries/{deliveryId}/retry`, operationId: "retryWebhookDelivery", summary: "Retry a dead delivery", tag: "Webhooks", security: "sessionCookie", note: "Management only.", response: z.strictObject({ id: z.string(), status: z.literal("PENDING") }), errors: [401, 403, 404] },
];

/** Routes of this lane that are in the V2 document and not in the frozen V1 contract (`src/api/accountOperations.ts`). */
export const LANE_C_NOT_IN_V1_CONTRACT: Record<string, string> = {
  ...Object.fromEntries(V2_OPERATIONS_C.map((o) => [o.path, o.tag === "Public API" ? "Public REST API, V2 (FIG-805)" : o.tag === "Webhooks" ? "Outbound webhooks, V2 (FIG-804)" : "API tokens, V2 (FIG-805)"])),
  "/api/v1/openapi.json": "Public REST API document, V2 (FIG-805)",
};
