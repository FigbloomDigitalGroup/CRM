import "dotenv/config";

/** Where the scale database lives (G1.04): `figbloom_crm_perf` on the same server as dev and test, with the same two roles. */
const ADMIN_URL = process.env.DATABASE_URL;
if (!ADMIN_URL) throw new Error("DATABASE_URL must be set (see .env.example).");

export const PERF_DB = "figbloom_crm_perf";
export const CONTROL_URL = ADMIN_URL;

function withDatabase(source: string): string {
  const u = new URL(source);
  u.pathname = `/${PERF_DB}`;
  return u.toString();
}

export const PERF_DATABASE_URL = withDatabase(ADMIN_URL);
export const PERF_APP_DATABASE_URL = withDatabase(process.env.APP_DATABASE_URL ?? ADMIN_URL.replace(/\/\/[^@]+@/, "//figbloom_app:x@"));

/** Points this process at the scale database. Everything that connects after this call (Prisma, the org-scoped client) uses it. */
export function usePerfDatabase(): void {
  process.env.DATABASE_URL = PERF_DATABASE_URL;
  process.env.APP_DATABASE_URL = PERF_APP_DATABASE_URL;
  process.env.TEST_DATABASE_URL = PERF_DATABASE_URL;
  process.env.TEST_APP_DATABASE_URL = PERF_APP_DATABASE_URL;
}
