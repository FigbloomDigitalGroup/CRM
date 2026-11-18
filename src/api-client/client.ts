/**
 * The typed API client the frontend builds against (G1.06): a thin runtime over the generated operation table.
 *
 *   const api = createClient({ baseUrl: "" });
 *   const page = await api.call("listLeads", { params: { orgSlug }, query: { pageSize: "25" } });
 *
 * Every non-2xx answer is thrown as an `ApiRequestError` carrying the one error envelope (`code`, `message`, `fieldErrors`, `denial`),
 * so a screen maps errors to its states kit in one place. Point `baseUrl` at the mock server (`npm run mock:api`) to build a screen
 * without a database.
 */
import { operations, type OperationId, type Operations } from "./generated";

export interface ErrorEnvelope {
  error: string;
  code: string;
  message: string;
  fieldErrors: { path: string; message: string; code?: string }[];
  requestId: string;
  denial?: { yourRole: string | null; ownerRoles: string[]; whoToAsk: string[] };
  feature?: { key: string; reason: "release" | "toggle"; availableIn: string | null };
  [key: string]: unknown;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly envelope: ErrorEnvelope,
    readonly operationId: string,
  ) {
    super(envelope.message || envelope.error || `Request failed (${status})`);
    this.name = "ApiRequestError";
  }
  get code() {
    return this.envelope.code;
  }
  get isForbidden() {
    return this.status === 403;
  }
}

export interface ClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Extra headers on every request (for example `x-mock-role` against the mock server). */
  headers?: () => Record<string, string>;
  /** Called with every error before it is thrown (for example to route a 401 to the sign-in screen). */
  onError?: (error: ApiRequestError) => void;
}

type Args<K extends OperationId> = (keyof Operations[K]["params"] extends never ? { params?: undefined } : { params: Operations[K]["params"] }) &
  (Operations[K]["query"] extends undefined ? { query?: undefined } : { query?: Operations[K]["query"] }) &
  (Operations[K]["body"] extends undefined ? { body?: undefined } : { body: Operations[K]["body"] }) & {
    /** Sent as `Idempotency-Key`; a retry of the same create with the same key is answered, not repeated. */
    idempotencyKey?: string;
    signal?: AbortSignal;
  };

export function buildUrl(path: string, params: Record<string, string> | undefined, query: Record<string, unknown> | undefined): string {
  let url = path.replace(/\{([A-Za-z0-9_]+)\}/g, (_m, name: string) => {
    const value = params?.[name];
    if (value === undefined) throw new Error(`Missing path parameter "${name}" for ${path}`);
    return encodeURIComponent(value);
  });
  if (query) {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) search.set(k, String(v));
    const text = search.toString();
    if (text) url += `?${text}`;
  }
  return url;
}

export function createClient(options: ClientOptions = {}) {
  const doFetch = options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const base = (options.baseUrl ?? "").replace(/\/$/, "");

  async function call<K extends OperationId>(id: K, args: Args<K>): Promise<Operations[K]["response"]> {
    const op = operations[id];
    const url = base + buildUrl(op.path, args.params as Record<string, string> | undefined, args.query as Record<string, unknown> | undefined);
    const headers: Record<string, string> = { accept: op.contentType === "csv" ? "text/csv" : "application/json", ...(options.headers?.() ?? {}) };
    let body: BodyInit | undefined;
    if (args.body !== undefined) {
      if (typeof FormData !== "undefined" && args.body instanceof FormData) body = args.body;
      else {
        headers["content-type"] = "application/json";
        body = JSON.stringify(args.body);
      }
    }
    if (args.idempotencyKey) headers["idempotency-key"] = args.idempotencyKey;
    const response = await doFetch(url, { method: op.method, headers, body, signal: args.signal, credentials: "same-origin" });
    if (!response.ok) {
      let envelope: ErrorEnvelope;
      try {
        envelope = (await response.json()) as ErrorEnvelope;
      } catch {
        envelope = { error: response.statusText, code: "INTERNAL_ERROR", message: response.statusText, fieldErrors: [], requestId: "" };
      }
      const error = new ApiRequestError(response.status, envelope, id);
      options.onError?.(error);
      throw error;
    }
    if (op.contentType === "csv") return (await response.text()) as Operations[K]["response"];
    if (response.status === 204) return undefined as Operations[K]["response"];
    return (await response.json()) as Operations[K]["response"];
  }

  return { call, operations };
}

export type ApiClient = ReturnType<typeof createClient>;
export { operations };
export type { OperationId, Operations };

/** The arguments of one call (`params`, `query`, `body`, `idempotencyKey`), as the operation's own types say they must be. */
export type CallArgs<K extends OperationId> = Args<K>;
