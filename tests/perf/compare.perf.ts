/**
 * Scratch comparison (not committed): the same measurements run in the baseline tree and in the working tree, against the scale database.
 * CMP_OUT names the JSON file written. Scenarios mirror tests/perf/api.perf.ts (real route handlers, auth mocked) plus the auth path on its own.
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../../src/auth/context";
import { adminDb } from "../../src/db/adminClient";
import { dbCallStats } from "../../src/db/orgScopedClient";
import { resolveActiveMembership } from "../../src/repositories/memberships";

const current: { ctx: AuthContext | null } = { ctx: null };
vi.mock("../../src/auth/requestContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/auth/requestContext")>();
  return { ...actual, resolveRequestContext: async () => current.ctx };
});

import { discoverRoutes, invoke, type DiscoveredRoute } from "../helpers/routeHarness";

const pct = (s: number[], p: number) => s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
const slug = "perf-alpha";

async function timed<T>(fn: () => Promise<T>, serial = 40, rounds = 5) {
  for (let i = 0; i < 3; i++) await fn();
  const times: number[] = [];
  for (let i = 0; i < serial; i++) {
    const t = performance.now();
    await fn();
    times.push(performance.now() - t);
  }
  const burst: number[] = [];
  for (let r = 0; r < rounds; r++)
    await Promise.all(Array.from({ length: 8 }, async () => { const t = performance.now(); await fn(); burst.push(performance.now() - t); }));
  times.sort((a, b) => a - b);
  burst.sort((a, b) => a - b);
  return { p50: pct(times, 50), p95: pct(times, 95), c8p95: pct(burst, 95) };
}

describe("compare", () => {
  it("measures", async () => {
    const routes = new Map<string, DiscoveredRoute>();
    for (const r of discoverRoutes()) for (const m of r.methods) routes.set(`${m} ${r.path.replace("/api/orgs/{orgSlug}", "")}`, r);
    const org = await adminDb.organization.findUniqueOrThrow({ where: { slug } });
    const ctxs: Record<string, AuthContext> = {};
    const users: Record<string, string> = {};
    for (const role of ["MANAGEMENT", "SALES", "FINANCE"]) {
      const u = await adminDb.user.findFirstOrThrow({ where: { email: `${slug}.${role.toLowerCase()}.0@example.test` } });
      users[role] = u.id;
      ctxs[role] = (await resolveActiveMembership(u.id, org.id))!;
    }
    const lead = await adminDb.lead.findFirstOrThrow({ where: { organizationId: org.id, ownerMembershipId: ctxs.SALES!.membershipId, archivedAt: null, convertedAt: null } });
    const out: Record<string, unknown> = { commit: process.env.CMP_LABEL };

    // 2. The auth path on its own (the perf harness mocks it).
    const auth: Record<string, unknown> = {};
    for (const role of ["MANAGEMENT", "SALES"]) {
      const m = await timed(async () => { await adminDb.organization.findUnique({ where: { slug } }); await resolveActiveMembership(users[role]!, org.id); }, 50, 3);
      const membershipOnly = await timed(async () => { await resolveActiveMembership(users[role]!, org.id); }, 50, 3);
      auth[role] = { orgPlusMembership: m, membershipOnly, permissionKeys: ctxs[role]!.permissionKeys.length };
    }
    // Statement count: log_statement is switched on for the perf database only, around one call.
    const U = process.env.CMP_PGUSER!;
    const psql = (sql: string) => execSync(`docker exec figbloom_crm_postgres_m13 psql -U ${U} -d postgres -c "${sql}"`, { stdio: "ignore" });
    psql(`ALTER DATABASE figbloom_crm_perf SET log_statement='all'`);
    await adminDb.$disconnect();
    const countStatements = async (fn: () => Promise<unknown>) => {
      const mark = `CMP_${Math.random().toString(36).slice(2, 8)}`;
      await adminDb.$queryRawUnsafe(`SELECT '${mark}_START'`);
      await fn();
      await adminDb.$queryRawUnsafe(`SELECT '${mark}_END'`);
      await new Promise((r) => setTimeout(r, 400));
      const log = execSync(`docker logs --tail 400 figbloom_crm_postgres_m13 2>&1`, { encoding: "utf8", maxBuffer: 1 << 26 });
      const lines = log.split("\n");
      const a = lines.findIndex((l) => l.includes(`${mark}_START`));
      const b = lines.findIndex((l) => l.includes(`${mark}_END`));
      return lines.slice(a + 1, b).filter((l) => /LOG:\s+(statement|execute [^:]*):/.test(l)).length;
    };
    auth.statementsOrgPlusMembership = await countStatements(async () => { await adminDb.organization.findUnique({ where: { slug } }); await resolveActiveMembership(users.MANAGEMENT!, org.id); });
    psql(`ALTER DATABASE figbloom_crm_perf RESET log_statement`);
    out.auth = auth;

    // 1/3. Lead detail endpoint set and a list, through the real route handlers.
    const call = (key: string, role: string, query = "", params: Record<string, string> = {}) => async () => {
      current.ctx = ctxs[role]!;
      const route = routes.get(key)!;
      return invoke(route, "GET", { orgSlug: slug, ...params }, { query });
    };
    const scenarios: [string, string, string, string, Record<string, string>][] = [
      ["GET lead", "GET /leads/{leadId}", "SALES", "", { leadId: lead.id }],
      ["GET qualification", "GET /leads/{leadId}/qualification", "SALES", "", { leadId: lead.id }],
      ["GET score", "GET /leads/{leadId}/score", "SALES", "", { leadId: lead.id }],
      ["GET activities?leadId", "GET /activities", "SALES", `?leadId=${lead.id}&pageSize=50`, {}],
      ["GET tasks?leadId", "GET /tasks", "SALES", `?leadId=${lead.id}`, {}],
      ["GET audit Lead (Management)", "GET /audit", "MANAGEMENT", `?entityType=Lead&entityId=${lead.id}`, {}],
      ["Leads first page (Management)", "GET /leads", "MANAGEMENT", "?pageSize=25", {}],
      ["Leads first page (Sales)", "GET /leads", "SALES", "?pageSize=25", {}],
      ["Tasks list (Sales)", "GET /tasks", "SALES", "?pageSize=25", {}],
      ["Deals first page (Management)", "GET /deals", "MANAGEMENT", "?pageSize=25", {}],
      ["Companies first page (Management)", "GET /companies", "MANAGEMENT", "?pageSize=25", {}],
      ["Contacts first page (Management)", "GET /contacts", "MANAGEMENT", "?pageSize=25", {}],
    ];
    const rows: unknown[] = [];
    for (const [name, key, role, query, params] of scenarios) {
      if (!routes.has(key)) { rows.push({ name, missing: true }); continue; }
      const f = call(key, role, query, params);
      await f();
      const before = dbCallStats.orgContextCalls;
      const r = await f();
      const dbCalls = dbCallStats.orgContextCalls - before;
      const t = await timed(f);
      const n = Array.isArray(r.json?.items) ? r.json.items.length : r.json && typeof r.json === "object" ? Object.keys(r.json).length : 0;
      const extra = key === "GET /my-work" ? { listSizes: Object.fromEntries(Object.entries(r.json ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v === "object" ? "obj" : v])) } : {};
      rows.push({ name, status: r.status, dbCalls, rowsOrKeys: n, bytes: r.text.length, ...t, ...extra });
    }
    out.endpoints = rows;

    // The assistant context builder, called directly.
    const { buildAssistantContext } = await import("../../src/assistant/context");
    const asst: unknown[] = [];
    for (const role of ["MANAGEMENT", "SALES"]) {
      const f = async () => buildAssistantContext(ctxs[role]!, { orgSlug: slug });
      try {
        await f();
        const before = dbCallStats.orgContextCalls;
        const r = await f();
        const dbCalls = dbCallStats.orgContextCalls - before;
        asst.push({ role, dbCalls, items: r.items.length, counts: r.counts, ...(await timed(f, 20, 3)) });
      } catch (e) {
        const t = performance.now();
        asst.push({ role, failed: String((e as Error).message).split(String.fromCharCode(10)).slice(-2).join(" ").slice(0, 200), failedAfterMsSeen: Math.round(performance.now() - t) });
      }
    }
    out.assistant = asst;
    const { getMyActionableWork } = await import("../../src/services/reportingService");
    const mywork: unknown[] = [];
    for (const role of ["MANAGEMENT", "SALES"]) {
      const f = async () => getMyActionableWork(ctxs[role]!);
      try {
        await f();
        const before = dbCallStats.orgContextCalls;
        const r: any = await f();
        const dbCalls = dbCallStats.orgContextCalls - before;
        mywork.push({ role, dbCalls, sizes: { dueToday: r.dueToday?.length, overdue: r.overdue?.length, newLeads: r.newLeads?.length, stalledDeals: r.stalledDeals?.length }, counts: r.counts ?? null, ...(await timed(f, 20, 3)) });
      } catch (e) {
        mywork.push({ role, failed: String((e as Error).message).split(String.fromCharCode(10)).slice(-2).join(" ").slice(0, 200) });
      }
    }
    out.mywork = mywork;
    writeFileSync(process.env.CMP_OUT ?? "compare.json", JSON.stringify(out, null, 2));
    expect(true).toBe(true);
  }, 1_800_000);
});
