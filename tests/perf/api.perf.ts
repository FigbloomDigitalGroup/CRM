/**
 * G1.04 (FIG-1071): performance at scale. Not part of `npm test`: it needs the scale database (`npx tsx scripts/perf-seed.ts`) and runs
 * with its own config:
 *
 *   npx vitest run --config vitest.perf.config.ts            # measure and print
 *   PERF_WRITE=1 npx vitest run --config vitest.perf.config.ts   # also rewrite docs/PERF_BASELINE.md
 *
 * Every scenario calls the real route handler (so authorisation, validation, masking and the data access are all in the time) as a real
 * role against organisation "perf-alpha" (40,000 leads, 16,000 contacts, 6,400 companies, 12,000 deals, 160,000 activities), once to warm,
 * then 40 times one after another and 8 at a time five times over. The figures are server time for the handler, without the network or
 * Next's own transport, so a client adds its round trip on top of what is here.
 *
 * Targets (G1.04): lists and search p95 under 300 ms, dashboards under 500 ms, Customer 360 under 600 ms, an import and an export stream
 * without the process's memory growing with the number of rows. A list's database calls must not grow with the page size (no N+1).
 */
import { writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../../src/auth/context";
import { adminDb } from "../../src/db/adminClient";
import { dbCallStats } from "../../src/db/orgScopedClient";
import { parseCsvRows } from "../../src/lib/csv";
import { resolveActiveMembership } from "../../src/repositories/memberships";

const current: { ctx: AuthContext | null } = { ctx: null };
vi.mock("../../src/auth/requestContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/auth/requestContext")>();
  return { ...actual, resolveRequestContext: async () => current.ctx };
});

import { discoverRoutes, invoke, type DiscoveredRoute } from "../helpers/routeHarness";

type Group = "list" | "search" | "dashboard" | "customer360" | "report" | "other";
const TARGET_MS: Record<Group, number> = { list: 300, search: 300, dashboard: 500, customer360: 600, report: 500, other: 500 };

interface Scenario {
  name: string;
  group: Group;
  role: string;
  key: string;
  query?: string;
  params?: Record<string, string>;
}

interface Result {
  scenario: Scenario;
  p50: number;
  p95: number;
  max: number;
  concurrentP95: number;
  dbCalls: number;
  status: number;
  bytes: number;
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;

describe("API performance at scale (G1.04)", () => {
  const routes = new Map<string, DiscoveredRoute>();
  const contexts: Record<string, AuthContext> = {};
  let orgId = "";
  const slug = "perf-alpha";
  const ids: Record<string, string> = {};
  const results: Result[] = [];
  const dataSize: Record<string, number> = {};

  async function setup() {
    for (const r of discoverRoutes()) for (const m of r.methods) routes.set(`${m} ${r.path.replace("/api/orgs/{orgSlug}", "")}`, r);
    const org = await adminDb.organization.findUniqueOrThrow({ where: { slug } });
    orgId = org.id;
    for (const role of ["MANAGEMENT", "SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL"]) {
      const user = await adminDb.user.findFirstOrThrow({ where: { email: `${slug}.${role.toLowerCase()}.0@example.test` } });
      contexts[role] = (await resolveActiveMembership(user.id, orgId))!;
    }
    const count = (table: string) => adminDb.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id = '${orgId}'`).then((r) => r[0]!.n);
    for (const t of ["leads", "contacts", "companies", "deals", "activities", "tasks", "communications", "notifications", "invoices"]) dataSize[t] = await count(t);
    ids.busyCompany = (await adminDb.company.findFirstOrThrow({ where: { organizationId: orgId, name: "Busiest Customer Ltd" } })).id;
    ids.status = (await adminDb.leadStatus.findFirstOrThrow({ where: { organizationId: orgId, key: "NEW" } })).id;
    ids.source = (await adminDb.leadSource.findFirstOrThrow({ where: { organizationId: orgId } })).id;
  }

  async function call(s: Scenario, role = s.role) {
    const route = routes.get(s.key);
    if (!route) throw new Error(`No route ${s.key}`);
    current.ctx = contexts[role]!;
    const method = s.key.split(" ")[0] as "GET";
    const values: Record<string, string> = { orgSlug: slug, ...(s.params ?? {}) };
    return invoke(route, method, values, { query: s.query });
  }

  async function measure(s: Scenario): Promise<Result> {
    for (let i = 0; i < 3; i++) await call(s);
    const times: number[] = [];
    let last = await call(s);
    const before = dbCallStats.orgContextCalls;
    await call(s);
    const dbCalls = dbCallStats.orgContextCalls - before;
    for (let i = 0; i < 40; i++) {
      const t = performance.now();
      last = await call(s);
      times.push(performance.now() - t);
    }
    const burst: number[] = [];
    for (let round = 0; round < 5; round++) {
      await Promise.all(
        Array.from({ length: 8 }, async () => {
          const t = performance.now();
          await call(s);
          burst.push(performance.now() - t);
        }),
      );
    }
    times.sort((a, b) => a - b);
    burst.sort((a, b) => a - b);
    return { scenario: s, p50: pct(times, 50), p95: pct(times, 95), max: times[times.length - 1]!, concurrentP95: pct(burst, 95), dbCalls, status: last.status, bytes: last.text.length };
  }

  const scenarios = (): Scenario[] => [
    { name: "Leads, first page (Management)", group: "list", role: "MANAGEMENT", key: "GET /leads", query: "?pageSize=25" },
    { name: "Leads, first page (Sales: own leads)", group: "list", role: "SALES", key: "GET /leads", query: "?pageSize=25" },
    { name: "Leads, filtered by status, newest first", group: "list", role: "MANAGEMENT", key: "GET /leads", query: `?pageSize=25&sort=-createdAt&statusId=${ids.status}` },
    { name: "Leads, deep page (page 1,200)", group: "list", role: "MANAGEMENT", key: "GET /leads", query: "?pageSize=25&page=1200" },
    { name: "Leads, search box text", group: "list", role: "MANAGEMENT", key: "GET /leads", query: "?pageSize=25&q=Lead%20note%2012345" },
    { name: "Contacts, first page", group: "list", role: "MANAGEMENT", key: "GET /contacts", query: "?pageSize=25" },
    { name: "Contacts, search", group: "search", role: "MANAGEMENT", key: "GET /contacts", query: "?pageSize=25&q=person1234" },
    { name: "Companies, first page", group: "list", role: "MANAGEMENT", key: "GET /companies", query: "?pageSize=25" },
    { name: "Companies, directory", group: "list", role: "MANAGEMENT", key: "GET /companies/directory", query: "?pageSize=25" },
    { name: "Deals, first page (Management)", group: "list", role: "MANAGEMENT", key: "GET /deals", query: "?pageSize=25" },
    { name: "Deals, board", group: "list", role: "MANAGEMENT", key: "GET /deals/board" },
    { name: "Deals, first page (Sales: own deals)", group: "list", role: "SALES", key: "GET /deals", query: "?pageSize=25" },
    { name: "Tasks, grouped by due date (Sales)", group: "list", role: "SALES", key: "GET /tasks/groups" },
    { name: "Notifications (Sales)", group: "list", role: "SALES", key: "GET /notifications" },
    { name: "Conversations hub", group: "list", role: "MANAGEMENT", key: "GET /conversations" },
    { name: "Invoices (Finance)", group: "list", role: "FINANCE", key: "GET /invoices", query: "?pageSize=25" },
    { name: "Global search: a company name", group: "search", role: "MANAGEMENT", key: "GET /search", query: "?q=Company%2012" },
    { name: "Global search: an email", group: "search", role: "MANAGEMENT", key: "GET /search", query: "?q=person1234%40mail" },
    { name: "Global search: a phone number", group: "search", role: "SALES", key: "GET /search", query: "?q=0722000" },
    { name: "Global search: a short word (Sales)", group: "search", role: "SALES", key: "GET /search", query: "?q=Lead" },
    { name: "Dashboard (Management)", group: "dashboard", role: "MANAGEMENT", key: "GET /dashboard" },
    { name: "Dashboard section: management", group: "dashboard", role: "MANAGEMENT", key: "GET /dashboard/{section}", params: { section: "management" } },
    { name: "Dashboard section: sales today (Sales)", group: "dashboard", role: "SALES", key: "GET /dashboard/{section}", params: { section: "sales_today" } },
    { name: "Dashboard section: finance (Finance)", group: "dashboard", role: "FINANCE", key: "GET /dashboard/{section}", params: { section: "finance" } },
    { name: "My metrics (Sales)", group: "dashboard", role: "SALES", key: "GET /reports/v2/my-metrics" },
    { name: "Customer 360: the busiest customer", group: "customer360", role: "MANAGEMENT", key: "GET /companies/{companyId}/360", params: { companyId: ids.busyCompany ?? "" } },
    { name: "Report: pipeline by stage", group: "report", role: "MANAGEMENT", key: "GET /reports/v2/{report}", params: { report: "PIPELINE_BY_STAGE" } },
    { name: "Report: lead sources", group: "report", role: "MANAGEMENT", key: "GET /reports/v2/{report}", params: { report: "LEAD_SOURCES" } },
    { name: "Report: conversion by source", group: "report", role: "MANAGEMENT", key: "GET /reports/v2/{report}", params: { report: "CONVERSION_BY_SOURCE" } },
    { name: "Report: per person", group: "report", role: "MANAGEMENT", key: "GET /reports/v2/{report}", params: { report: "PER_PERSON" } },
    { name: "Report: month against last month", group: "report", role: "MANAGEMENT", key: "GET /reports/v2/{report}", params: { report: "MONTH_VS_LAST" } },
    { name: "Report: customers", group: "report", role: "MANAGEMENT", key: "GET /reports/v2/{report}", params: { report: "CUSTOMERS" } },
    { name: "Calendar: a week", group: "other", role: "SALES", key: "GET /calendar", query: "?view=week&date=2026-10-26" },
    { name: "Payments summary (Finance)", group: "other", role: "FINANCE", key: "GET /payments/summary" },
  ];

  it("meets the response-time targets", async () => {
    await setup();
    expect(dataSize.leads).toBeGreaterThan(35_000);
    for (const s of scenarios()) results.push(await measure(s));
    const failures = results.filter((r) => r.status >= 400 || r.p95 > TARGET_MS[r.scenario.group]);
    for (const r of results) {
      console.log(`${r.p95 > TARGET_MS[r.scenario.group] || r.status >= 400 ? "MISS" : "ok  "} ${r.scenario.name.padEnd(46)} p50 ${r.p50.toFixed(0).padStart(4)}  p95 ${r.p95.toFixed(0).padStart(4)}  c8 p95 ${r.concurrentP95.toFixed(0).padStart(4)}  db ${String(r.dbCalls).padStart(2)}  ${r.status}  ${r.bytes}B`);
    }
    if (process.env.PERF_WRITE) writeFileSync(process.env.PERF_RESULTS ?? "perf-results.json", JSON.stringify({ dataSize, results, targets: TARGET_MS }, null, 2));
    if (process.env.PERF_ASSERT !== "0") expect(failures.map((r) => r.scenario.name)).toEqual([]);
  }, 1_800_000);

  it("makes the same number of database calls for a page of 5 as for a page of 100 (no N+1)", async () => {
    if (!routes.size) await setup();
    const keys: [string, string, string][] = [
      ["GET /leads", "MANAGEMENT", ""],
      ["GET /contacts", "MANAGEMENT", ""],
      ["GET /companies", "MANAGEMENT", ""],
      ["GET /deals", "MANAGEMENT", ""],
      ["GET /tasks", "MANAGEMENT", ""],
      ["GET /invoices", "FINANCE", ""],
    ];
    const grown: string[] = [];
    for (const [key, role] of keys) {
      const small = { name: key, group: "list" as Group, role, key, query: "?pageSize=5" };
      const large = { ...small, query: "?pageSize=100" };
      await call(small);
      const a = dbCallStats.orgContextCalls;
      await call(small);
      const smallCalls = dbCallStats.orgContextCalls - a;
      const b = dbCallStats.orgContextCalls;
      await call(large);
      const largeCalls = dbCallStats.orgContextCalls - b;
      console.log(`N+1 check ${key.padEnd(18)} page 5: ${smallCalls} calls, page 100: ${largeCalls} calls`);
      if (largeCalls !== smallCalls) grown.push(`${key}: ${smallCalls} -> ${largeCalls}`);
    }
    expect(grown).toEqual([]);
  }, 300_000);

  it("streams a full export of the leads without the process's memory following the row count", async () => {
    if (!routes.size) await setup();
    const route = routes.get("GET /leads/export")!;
    current.ctx = contexts.MANAGEMENT!;
    const response = await (route.module.GET as (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>)(
      new Request("http://localhost/export"),
      { params: Promise.resolve({ orgSlug: slug }) },
    );
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const startHeap = process.memoryUsage().heapUsed;
    let peak = startHeap;
    let bytes = 0;
    let rows = 0;
    const t0 = performance.now();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      for (const b of value) if (b === 10) rows++;
      peak = Math.max(peak, process.memoryUsage().heapUsed);
    }
    const seconds = (performance.now() - t0) / 1000;
    const growthMb = (peak - startHeap) / 1024 / 1024;
    console.log(`Export stream: ${rows} rows, ${(bytes / 1024 / 1024).toFixed(1)} MB in ${seconds.toFixed(1)}s, peak heap growth ${growthMb.toFixed(0)} MB`);
    if (process.env.PERF_WRITE) writeFileSync(process.env.PERF_EXPORT ?? "perf-export.json", JSON.stringify({ rows, megabytes: bytes / 1024 / 1024, seconds, peakHeapGrowthMb: growthMb }));
    expect(rows).toBeGreaterThan(30_000);
    // 40,000 rows is about 10 MB of CSV; a stream keeps a few buffers, not the file.
    expect(growthMb).toBeLessThan(120);
  }, 600_000);

  it("reads a 150,000-row import file row by row without the process's memory following the row count", async () => {
    const total = 150_000;
    async function* chunks() {
      yield ["First name", "Last name", "Email", "Phone", "Company"].join(",") + String.fromCharCode(10);
      for (let i = 0; i < total; i++) {
        const row = [`First${i}`, `Last${i % 500}`, `person${i}@import.example.test`, `+2547${String(10000000 + i).padStart(8, "0")}`, `Import Co ${i % 3000}`];
        yield row.join(",") + String.fromCharCode(10);
      }
    }
    const startHeap = process.memoryUsage().heapUsed;
    let peak = startHeap;
    let rows = 0;
    const t0 = performance.now();
    for await (const row of parseCsvRows(Readable.from(chunks()))) {
      if (row["Email"]) rows++;
      if (rows % 5000 === 0) peak = Math.max(peak, process.memoryUsage().heapUsed);
    }
    const seconds = (performance.now() - t0) / 1000;
    const growthMb = (peak - startHeap) / 1024 / 1024;
    console.log(`Import parse: ${rows} rows in ${seconds.toFixed(1)}s, peak heap growth ${growthMb.toFixed(0)} MB`);
    if (process.env.PERF_WRITE) writeFileSync(process.env.PERF_IMPORT ?? "perf-import.json", JSON.stringify({ rows, seconds, peakHeapGrowthMb: growthMb }));
    expect(rows).toBe(total);
    expect(growthMb).toBeLessThan(60);
  }, 300_000);
});
