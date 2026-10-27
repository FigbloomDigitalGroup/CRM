import accessMatrix from "./contract/accessMatrix.json";
import responseShapes from "./contract/responseShapes.json";
import routeSchemas from "./contract/routeSchemas.json";
import type { JsonSchema } from "./jsonSchema";

/**
 * Operations the OpenAPI document gets from the recorded walk instead of a hand-written definition (G1.06).
 *
 * The walk in tests/apiWalk.test.ts calls every route as every role and records, per route: the request schemas the route itself
 * validated against (so a body or query can never be documented differently from what the route accepts), the shape of its answer, and
 * which roles it lets in (the permission matrix). Routes with a hand-written `OperationDef` keep it; every other route is documented
 * from the recording and marked `x-contract-source: derived`. Regenerate with `UPDATE_API_SNAPSHOTS=1` (see docs/API_CHANGELOG.md).
 */

const ORG_PREFIX = "/api/orgs/{orgSlug}";
const ROLES: string[] = (accessMatrix as { roles: string[] }).roles;
const ROWS = (accessMatrix as { rows: Record<string, string> }).rows;
const SCHEMAS = routeSchemas as Record<string, { body?: JsonSchema; query?: JsonSchema }>;
const SHAPES = responseShapes as Record<string, JsonSchema>;

/** Routes that take a file upload rather than JSON. */
const MULTIPART = new Set([
  "POST /api/orgs/{orgSlug}/imports",
  "POST /api/orgs/{orgSlug}/leads/import",
  "POST /api/orgs/{orgSlug}/contacts/import",
  "POST /api/orgs/{orgSlug}/companies/import",
  "POST /api/orgs/{orgSlug}/data-migration/sessions/{sessionId}/file",
]);

const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export function operationIdFor(method: string, path: string): string {
  const rest = path.slice(ORG_PREFIX.length) || "/";
  const parts = rest
    .split("/")
    .filter(Boolean)
    .map((seg) => {
      const param = /^\{(\w+)\}$/.exec(seg);
      const words = (param ? `by-${param[1]}` : seg).split(/[^A-Za-z0-9]+/).filter(Boolean);
      return words.map(cap).join("");
    });
  return `${method.toLowerCase()}${parts.join("")}`;
}

function tagFor(path: string): string {
  const seg = path.slice(ORG_PREFIX.length).split("/").filter(Boolean)[0] ?? "Other";
  return seg
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(cap)
    .join(" ");
}

/** `{ ROLE: "A" | "D" | "H" | "V" }` from the walk: reached, refused, hidden (404), or reached but failed a rule. */
export function roleOutcomesFor(key: string): Record<string, string> | null {
  const row = ROWS[key];
  if (!row) return null;
  return Object.fromEntries(ROLES.map((r, i) => [r, row[i]!]));
}

export function allowedRolesFor(key: string): string[] | null {
  const row = ROWS[key];
  if (!row) return null;
  return ROLES.filter((_, i) => row[i] !== "D" && row[i] !== "U");
}

export interface DerivedOperation {
  key: string;
  method: string;
  path: string;
  operation: Record<string, unknown>;
}

const ERROR_REF = { content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" } } } };

export function derivedOperations(documented: Set<string>): DerivedOperation[] {
  const out: DerivedOperation[] = [];
  for (const key of Object.keys(ROWS).sort()) {
    if (documented.has(key)) continue;
    const [METHOD, path] = key.split(" ") as [string, string];
    const method = METHOD.toLowerCase();
    const recorded = SCHEMAS[key] ?? {};
    const parameters: Record<string, unknown>[] = [];
    for (const name of path.match(/\{(\w+)\}/g) ?? []) {
      parameters.push({ name: name.slice(1, -1), in: "path", required: true, schema: { type: "string" } });
    }
    const queryProps: Record<string, JsonSchema> = recorded.query?.properties ?? {};
    const queryRequired = new Set<string>(recorded.query?.required ?? []);
    for (const [name, schema] of Object.entries(queryProps)) {
      parameters.push({ name, in: "query", required: queryRequired.has(name), schema });
    }
    const isCsv = /\/export(\/|$)|\/export$|-export$/.test(path) && METHOD === "GET";
    const shape = SHAPES[key];
    const roles = allowedRolesFor(key);
    const responses: Record<string, unknown> = {
      200: {
        description: "Success",
        headers: { "x-request-id": { schema: { type: "string" } } },
        content: isCsv ? { "text/csv": { schema: { type: "string" } } } : { "application/json": { schema: shape ?? {} } },
      },
      401: { description: "Not signed in.", ...ERROR_REF },
      500: { description: "Unexpected error.", ...ERROR_REF },
    };
    if (recorded.body || recorded.query || MULTIPART.has(key)) responses[400] = { description: "Validation failed (`fieldErrors` lists the fields).", ...ERROR_REF };
    if (roles && roles.length < ROLES.length) responses[403] = { description: "Not allowed (`denial` explains who can).", ...ERROR_REF };
    if (path.includes("{") && path !== `${ORG_PREFIX}`) responses[404] = { description: "Not found in this organisation, or hidden from this role.", ...ERROR_REF };
    const body = MULTIPART.has(key)
      ? { required: true, content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] } } } }
      : recorded.body
        ? { required: true, content: { "application/json": { schema: recorded.body } } }
        : undefined;
    out.push({
      key,
      method,
      path,
      operation: {
        operationId: operationIdFor(method, path),
        summary: `${METHOD} ${path.slice(ORG_PREFIX.length) || "/"}`,
        tags: [tagFor(path)],
        security: [{ sessionCookie: [] }],
        parameters,
        ...(body ? { requestBody: body } : {}),
        responses,
        "x-contract-source": "derived",
        ...(roles ? { "x-allowed-roles": roles } : {}),
        ...(roles ? { "x-role-outcomes": roleOutcomesFor(key) } : {}),
      },
    });
  }
  return out;
}
