import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { exampleFor, type JsonSchema } from "./jsonSchema";

/**
 * The mock server (G1.06): answers every operation in the OpenAPI document, so a screen can be built with no database and no
 * running backend.
 *
 *  - The caller's role comes from the `x-mock-role` header (MANAGEMENT, SALES, DELIVERY, FINANCE, RESTRICTED_TECHNICAL,
 *    CUSTOMER_SUPPORT; `none` means signed out). Default MANAGEMENT.
 *  - A role the permission matrix refuses gets the real explained 403 envelope; signed out gets 401.
 *  - Otherwise the answer is the recorded example for that role (the seeded organisation's real response, masked the way the real
 *    API masks it), falling back to the shared example, then to one built from the schema.
 *  - Stateless: a create or an update answers with its example and changes nothing.
 */

export interface MockOptions {
  doc: any;
  /** `{ "METHOD /path": { default, ROLE: body, ... } }` recorded from the seeded organisation. */
  examples: Record<string, Record<string, unknown>>;
}

const ROLES = ["MANAGEMENT", "SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL", "CUSTOMER_SUPPORT"];

/** The real explained denial names roles the way people do ("Restricted Technical"), not by key; the mock does the same so screens show the right words. */
const ROLE_LABEL: Record<string, string> = {
  MANAGEMENT: "Management",
  SALES: "Sales",
  DELIVERY: "Delivery",
  FINANCE: "Finance",
  RESTRICTED_TECHNICAL: "Restricted Technical",
  CUSTOMER_SUPPORT: "Customer Support",
};
const labelOf = (key: string) => ROLE_LABEL[key] ?? key;

interface Route {
  method: string;
  template: string;
  pattern: RegExp;
  op: any;
}

function compile(doc: any): Route[] {
  const routes: Route[] = [];
  for (const [template, item] of Object.entries<any>(doc.paths ?? {})) {
    const pattern = new RegExp(`^${template.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[A-Za-z0-9_]+\}/g, "[^/]+")}$`);
    for (const [method, op] of Object.entries<any>(item)) routes.push({ method: method.toUpperCase(), template, pattern, op });
  }
  // A literal segment beats a parameter ("/leads/pool" before "/leads/{leadId}").
  return routes.sort((a, b) => a.template.split("{").length - b.template.split("{").length);
}

function envelope(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return { status, body: { error: message, code, message, fieldErrors: [], requestId: "mock-request", ...extra } };
}

export function mockResponse(options: MockOptions, method: string, pathname: string, role: string): { status: number; body: unknown; contentType?: string } {
  const routes = compile(options.doc);
  const route = routes.find((r) => r.method === method && r.pattern.test(pathname));
  if (!route) return envelope(404, "NOT_FOUND", `No operation ${method} ${pathname} in the contract.`);
  if (role === "none") return envelope(401, "UNAUTHORIZED", "Not signed in.");
  const allowed: string[] | undefined = route.op["x-allowed-roles"];
  if (allowed && !allowed.includes(role)) {
    return envelope(403, "FORBIDDEN", "Your role cannot do this.", { denial: { yourRole: labelOf(role), ownerRoles: allowed.slice(0, 3).map(labelOf), whoToAsk: ["Management"] } });
  }
  const key = `${method} ${route.template}`;
  const recorded = options.examples[key];
  const status = Number(Object.keys(route.op.responses ?? {}).find((s) => s.startsWith("2")) ?? 200);
  if (recorded) {
    const sameAsDefault = Array.isArray(recorded.same) && (recorded.same as string[]).includes(role);
    if (role in recorded || sameAsDefault) {
      const body = sameAsDefault ? recorded.default : recorded[role];
      const csv = typeof body === "string" && route.op.responses?.[String(status)]?.content?.["text/csv"];
      return { status, body, contentType: csv ? "text/csv" : undefined };
    }
    // No answer was recorded for this role: the real API hid the record (404) or refused the request, so never lend it another role's data.
    if (route.op["x-role-outcomes"]?.[role] === "H") return envelope(404, "NOT_FOUND", "Not found in this organisation, or hidden from your role.");
  }
  // Built from the schema, never from another role's recorded data.
  const schema: JsonSchema | undefined = route.op.responses?.[String(status)]?.content?.["application/json"]?.schema;
  return { status, body: schema ? exampleFor(schema, key, options.doc) : {} };
}

export function createMockServer(options: MockOptions): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const cors = {
      "access-control-allow-origin": req.headers.origin ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "content-type, idempotency-key, x-mock-role",
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors).end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    const header = String(req.headers["x-mock-role"] ?? "MANAGEMENT").toUpperCase();
    const role = header === "NONE" ? "none" : ROLES.includes(header) ? header : "MANAGEMENT";
    const out = mockResponse(options, req.method ?? "GET", url.pathname, role);
    const text = typeof out.body === "string" ? out.body : JSON.stringify(out.body);
    res.writeHead(out.status, { ...cors, "content-type": out.contentType ?? "application/json", "x-request-id": "mock-request" });
    res.end(text);
  });
}
