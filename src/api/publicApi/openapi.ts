import { z } from "zod";
import { API_SCOPES } from "../../auth/apiToken";
import { WEBHOOK_EVENT_TYPES } from "../../lib/webhookEvents";
import { ErrorEnvelopeSchema } from "../dto/common";
import { V2_OPERATIONS_C, type V2Operation } from "../v2OperationsC";
import { WebhookEventPayload } from "./schemas";

/**
 * The OpenAPI 3.1 document of the public REST API (FIG-805), generated from the Zod schemas the routes parse with. It is a document of its
 * own: the frozen V1 contract (`src/api/contract/openapi.v1.json`) is not touched. It covers `/api/v1/*` (bearer token), and the token
 * and webhook management routes the application's own pages call (session), with the webhook event payload as a component.
 *
 * Served by `GET /api/v1/openapi.json` to signed-in people and to token holders. It is built on request from the Zod schemas, so it cannot
 * drift from the routes; `tests/publicApi.test.ts` checks it.
 */
export const PUBLIC_API_VERSION = "1.0.0";

function json(schema: z.ZodType, io: "input" | "output" = "output") {
  const out = z.toJSONSchema(schema, { io, unrepresentable: "any", reused: "inline" }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

const ERROR_TEXT: Record<number, string> = {
  400: "The request is malformed or breaks a rule (fieldErrors lists each problem).",
  401: "Missing, invalid, expired or revoked token (or not signed in).",
  403: "The token lacks the scope, the person behind it may not do this, or the feature is not available to the organisation.",
  404: "No such record, or the person behind the token may not see it.",
  409: "Conflict, for example an Idempotency-Key still being processed.",
  422: "The Idempotency-Key was used for a different request.",
  429: "Too many requests. Slow down and retry.",
};

function parameters(op: V2Operation) {
  const params: Record<string, unknown>[] = [];
  for (const name of op.path.match(/\{(\w+)\}/g) ?? []) {
    params.push({ name: name.slice(1, -1), in: "path", required: true, schema: { type: "string" } });
  }
  if (op.query) {
    const schema = json(op.query, "input") as { properties?: Record<string, unknown>; required?: string[] };
    for (const [name, s] of Object.entries(schema.properties ?? {})) {
      params.push({ name, in: "query", required: schema.required?.includes(name) ?? false, schema: s });
    }
  }
  if (op.idempotent) {
    params.push({ name: "Idempotency-Key", in: "header", required: false, description: "A unique string (8 to 200 characters). Repeating the request with the same key returns the first answer instead of creating the record again.", schema: { type: "string" } });
  }
  return params;
}

export function buildPublicApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  const tags = new Set<string>();
  for (const op of V2_OPERATIONS_C) {
    const responses: Record<string, unknown> = {
      200: { description: "Success", headers: { "x-request-id": { schema: { type: "string" } } }, content: { "application/json": { schema: json(op.response) } } },
      500: { description: "Unexpected error.", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } } },
    };
    for (const status of op.errors) {
      responses[String(status)] = { description: ERROR_TEXT[status], content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } } };
    }
    tags.add(op.tag);
    (paths[op.path] ??= {})[op.method] = {
      operationId: op.operationId,
      summary: op.summary,
      tags: [op.tag],
      security: [{ [op.security]: [] }],
      ...(op.scope ? { "x-required-scope": op.scope } : {}),
      ...(op.note ? { description: op.note } : {}),
      parameters: parameters(op),
      ...(op.body ? { requestBody: { required: true, content: { "application/json": { schema: json(op.body, "input") } } } } : {}),
      responses,
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Figbloom CRM public API",
      version: PUBLIC_API_VERSION,
      description:
        "Read and write companies, contacts, leads, deals, tasks and activities with a personal API token. A token runs as the person who created it, " +
        "so every permission, ownership and masking rule that applies to them applies to the token; scopes can only narrow it. " +
        "Send `Authorization: Bearer <token>`. Lists are paged (`limit`, `cursor`). Creates accept an `Idempotency-Key`. Requests are rate-limited per token (429). " +
        "Errors use one envelope (`ErrorEnvelope`). Outbound webhooks are described under `x-webhooks`; verify each delivery with the signature header.",
    },
    servers: [{ url: "/" }],
    tags: [...tags].sort().map((name) => ({ name })),
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    "x-webhooks": {
      events: [...WEBHOOK_EVENT_TYPES],
      headers: {
        "X-Figbloom-Event": "The event type.",
        "X-Figbloom-Delivery": "The delivery id (changes per endpoint, not per attempt).",
        "X-Figbloom-Timestamp": "Unix seconds when this attempt was signed. Refuse a delivery older than 5 minutes.",
        "X-Figbloom-Signature": "v1=<hex HMAC-SHA256 of '<timestamp>.<raw body>' with the endpoint secret>",
      },
      payload: json(WebhookEventPayload),
    },
    components: {
      securitySchemes: {
        bearerToken: { type: "http", scheme: "bearer", description: `A personal API token (fbk_...). Scopes: ${API_SCOPES.join(", ")}.` },
        sessionCookie: { type: "apiKey", in: "cookie", name: "figbloom_session", description: "The signed-in browser session; used by the application's own settings pages." },
      },
      schemas: { ErrorEnvelope: json(ErrorEnvelopeSchema) },
    },
  };
}
