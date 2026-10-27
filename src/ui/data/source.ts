/**
 * Which API the screens talk to (F1.06): the real one, or the mock server (`npm run mock:api`, G1.06) for building a screen without a
 * database and for the component gallery. The mock is a development tool only: in a production build the answer is always "real", whatever
 * is set, so a stray variable can never point a customer's browser at sample data.
 */

export type DataSourceKind = "real" | "mock";

export interface DataSource {
  kind: DataSourceKind;
  /** Empty for the real API (same origin). */
  baseUrl: string;
  /** The role the mock acts as (`x-mock-role`); only for the mock. */
  mockRole: string | null;
}

export interface DataSourceInput {
  nodeEnv?: string;
  /** `NEXT_PUBLIC_API_SOURCE`: "real" or "mock". */
  source?: string | null;
  /** `NEXT_PUBLIC_MOCK_API_URL`: defaults to the mock server's own port. */
  mockUrl?: string | null;
  /** The page's query string, so `?api=mock&role=SALES` flips one browser tab while developing. */
  search?: string | null;
}

export const DEFAULT_MOCK_URL = "http://localhost:4010";
export const MOCK_ROLES = ["MANAGEMENT", "SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL", "CUSTOMER_SUPPORT"] as const;

export function resolveDataSource(input: DataSourceInput): DataSource {
  const real: DataSource = { kind: "real", baseUrl: "", mockRole: null };
  if (input.nodeEnv === "production") return real;

  const params = new URLSearchParams(input.search ?? "");
  const wanted = (params.get("api") ?? input.source ?? "real").toLowerCase();
  if (wanted !== "mock") return real;

  const role = (params.get("role") ?? "MANAGEMENT").toUpperCase();
  return {
    kind: "mock",
    baseUrl: (input.mockUrl || DEFAULT_MOCK_URL).replace(/\/$/, ""),
    mockRole: (MOCK_ROLES as readonly string[]).includes(role) || role === "NONE" ? role : "MANAGEMENT",
  };
}

export function currentDataSource(): DataSource {
  return resolveDataSource({
    nodeEnv: process.env.NODE_ENV,
    source: process.env.NEXT_PUBLIC_API_SOURCE,
    mockUrl: process.env.NEXT_PUBLIC_MOCK_API_URL,
    search: typeof window === "undefined" ? "" : window.location.search,
  });
}
