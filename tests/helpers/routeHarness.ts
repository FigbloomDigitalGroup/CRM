/// <reference types="vite/client" />
/**
 * Shared by the generated authorization matrix (G1.02) and the cross-organisation attack suite (G1.03): finds every API route
 * handler on disk, turns its folder path into a URL template, and fills the dynamic segments so the handler can be called directly.
 *
 * The routes are loaded with `import.meta.glob`, so a route added tomorrow is picked up with no list to maintain.
 */

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export type RouteHandler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

export interface DiscoveredRoute {
  /** Repo-relative file, for example `src/app/api/orgs/[orgSlug]/leads/route.ts`. */
  file: string;
  /** The URL template, for example `/api/orgs/{orgSlug}/leads`. */
  path: string;
  methods: HttpMethod[];
  /** Dynamic segment names in order, for example `["orgSlug", "leadId"]`. */
  params: string[];
  module: Record<string, unknown>;
}

const modules = import.meta.glob("../../src/app/api/**/route.ts", { eager: true }) as Record<string, Record<string, unknown>>;

function templateFor(file: string): { path: string; params: string[] } {
  const relative = file.replace(/^.*src\/app/, "").replace(/\/route\.ts$/, "");
  const params: string[] = [];
  const path = relative.replace(/\[(?:\.\.\.)?([A-Za-z0-9_]+)\]/g, (_m, name: string) => {
    params.push(name);
    return `{${name}}`;
  });
  return { path, params };
}

export function discoverRoutes(): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];
  for (const [key, module] of Object.entries(modules)) {
    const file = `src/app${key.replace(/^.*src\/app/, "")}`;
    const { path, params } = templateFor(file);
    const methods = HTTP_METHODS.filter((m) => typeof module[m] === "function");
    routes.push({ file, path, methods, params, module });
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || 0);
}

/** Routes that sit under an organisation and resolve the caller through the organisation's membership. */
export function isOrganisationRoute(route: DiscoveredRoute): boolean {
  return route.path.startsWith("/api/orgs/{orgSlug}");
}

/**
 * Values for dynamic segments that must be a known word rather than an id (a list kind, an entity name, a rule key). Anything not
 * listed here is a random UUID, which no row can have, so an allowed caller gets 404 and a refused caller gets 403.
 */
const KNOWN_SEGMENTS: Record<string, string> = {
  kind: "services",
  entity: "LEAD",
  ruleKey: "NEW_LEAD_FOLLOW_UP_TASK",
  type: "LEAD",
  group: "TODAY",
  catalogKey: "leadSources",
  report: "LEAD_SOURCES",
  section: "management",
};

export const NO_SUCH_ID = "00000000-0000-4000-8000-000000000000";

export function fillParams(route: DiscoveredRoute, orgSlug: string, lookup: (name: string) => string | undefined = () => undefined): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of route.params) {
    values[name] = name === "orgSlug" ? orgSlug : (lookup(name) ?? KNOWN_SEGMENTS[name] ?? NO_SUCH_ID);
  }
  return values;
}

export function urlFor(route: DiscoveredRoute, values: Record<string, string>): string {
  let url = route.path;
  for (const [name, value] of Object.entries(values)) url = url.replace(`{${name}}`, encodeURIComponent(value));
  return `http://localhost${url}`;
}

export async function invoke(
  route: DiscoveredRoute,
  method: HttpMethod,
  values: Record<string, string>,
  options: { body?: unknown; form?: FormData; headers?: Record<string, string>; query?: string } = {},
): Promise<{ status: number; code: string | null; json: any; text: string; response: Response }> {
  const handler = route.module[method] as RouteHandler;
  const hasBody = method !== "GET" && method !== "DELETE";
  const body = options.form ? undefined : (options.body ?? (hasBody ? {} : undefined));
  const request = new Request(`${urlFor(route, values)}${options.query ?? ""}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(options.headers ?? {}) },
    ...(options.form ? { body: options.form } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const response = await handler(request, { params: Promise.resolve(values) });
  const text = await response.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, code: typeof json?.code === "string" ? json.code : null, json, text, response };
}
