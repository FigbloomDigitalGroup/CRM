/**
 * G2.03 (FIG-1158): performance of what V1.1 added, on the scale database of G1.04 (tests/perf/api.perf.ts). Not part of `npm test`.
 *
 *   npx tsx scripts/perf-seed.ts                                       # once: the scale database (skips if already seeded)
 *   npx vitest run --config vitest.perf.config.ts tests/perf/v11.perf.ts    # seeds the V1.1 rows if missing, measures, prints
 *   PERF_WRITE=1 ...                                                   # also writes perf-v11-results.json
 *
 * Organisation "perf-alpha" (40,000 leads, 12,000 deals) is moved to release V1.1 and given 60 catalogue items, 400 quotes with two lines each, 150
 * discount approvals, saved views, 12 chat channels with 6,000 messages, 3 follow-up sequences and monthly targets. Every scenario calls the real
 * route handler as a real role (authorisation, validation, masking and the data access are all in the time), once to warm, then 40 times in a
 * row and 8 at a time five times over. The assistant is measured as the server's work before the model is called (the context it builds and
 * filters) with a stub model that answers at once, because the model's own time is not ours to budget.
 *
 * Targets (G2.03): lists, approvals inbox and chat under 300 ms p95; quote detail, forecast and assistant context under 500 ms; a list's database
 * calls must not grow with the page size (no N+1).
 */
import { writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../../src/auth/context";
import { setAssistantProviderFactory } from "../../src/assistant/provider";
import { adminDb } from "../../src/db/adminClient";
import { dbCallStats } from "../../src/db/orgScopedClient";
import { TOGGLES_KEY } from "../../src/lib/featureConfig";
import { resolveActiveMembership } from "../../src/repositories/memberships";
import { requestDiscountApproval } from "../../src/services/approvalService";
import { askAssistant, updateAssistantSettings } from "../../src/services/assistantService";
import { createCatalogueEntry } from "../../src/services/catalogueService";
import { createChannel, postMessage } from "../../src/services/chatService";
import { setOrganizationRelease } from "../../src/services/featureService";
import { createSequence } from "../../src/services/followUpService";
import { setTarget } from "../../src/services/forecastService";
import { createQuote } from "../../src/services/quoteService";
import { createView } from "../../src/services/savedViewService";

const current: { ctx: AuthContext | null } = { ctx: null };
vi.mock("../../src/auth/requestContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/auth/requestContext")>();
  return { ...actual, resolveRequestContext: async () => current.ctx };
});

import { discoverRoutes, invoke, type DiscoveredRoute } from "../helpers/routeHarness";

type Group = "list" | "detail" | "forecast" | "chat" | "assistant";
const TARGET_MS: Record<Group, number> = { list: 300, detail: 500, forecast: 500, chat: 300, assistant: 500 };

interface Scenario {
  name: string;
  group: Group;
  role: string;
  /** "GET /quotes", or "service:assistant" for the assistant's context building. */
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
  error?: string;
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
/** The 40,000-lead organisation. It is "perf-alpha" in a database built by scripts/perf-seed.ts; set PERF_ORG_SLUG when it was renamed (the users keep the perf-alpha addresses). */
const slug = process.env.PERF_ORG_SLUG ?? "perf-alpha";
const userPrefix = process.env.PERF_USER_PREFIX ?? "perf-alpha";

describe("V1.1 API performance at scale (G2.03)", () => {
  const routes = new Map<string, DiscoveredRoute>();
  const contexts: Record<string, AuthContext> = {};
  const ids: Record<string, string> = {};
  const results: Result[] = [];
  const seeded: Record<string, number> = {};
  let orgId = "";

  async function seedV11() {
    const org = await adminDb.organization.findUniqueOrThrow({ where: { slug } });
    orgId = org.id;
    await setOrganizationRelease(orgId, "v1.1");
    await adminDb.organizationSetting.upsert({ where: { organizationId_key: { organizationId: orgId, key: TOGGLES_KEY } }, update: { value: { "assistant.enabled": true } }, create: { organizationId: orgId, key: TOGGLES_KEY, value: { "assistant.enabled": true } } });
    for (const role of ["MANAGEMENT", "SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL"]) {
      const user = await adminDb.user.findFirstOrThrow({ where: { email: `${userPrefix}.${role.toLowerCase()}.0@example.test` } });
      contexts[role] = (await resolveActiveMembership(user.id, orgId))!;
    }
    const mgmt = contexts.MANAGEMENT!;
    // The daily question limits would turn the measurement into timing a refusal: raise them to their ceilings (200 a person, 5,000 an organisation).
    await updateAssistantSettings(mgmt, { dailyLimitPerUser: 200, dailyLimitPerOrg: 5000 } as any);
    if ((await adminDb.catalogueItem.count({ where: { organizationId: orgId } })) < 60) {
      for (let i = 0; i < 60; i++) await createCatalogueEntry(mgmt, { name: `Perf item ${i}`, price: 1000 + i * 250, cost: 600 + i * 100, unit: "unit" });
    }
    const items = await adminDb.catalogueItem.findMany({ where: { organizationId: orgId }, take: 60, select: { id: true } });
    if ((await adminDb.quote.count({ where: { organizationId: orgId } })) < 400) {
      const deals = await adminDb.deal.findMany({ where: { organizationId: orgId }, take: 400, orderBy: { createdAt: "asc" }, select: { id: true } });
      for (const [i, deal] of deals.entries()) {
        await createQuote(mgmt, deal.id, { lines: [{ catalogueItemId: items[i % 60]!.id, quantity: 1 + (i % 4) }, { catalogueItemId: items[(i + 7) % 60]!.id, quantity: 2 }], discountPercent: i % 3 === 0 ? 25 : 5 }).catch(() => null);
      }
    }
    const quotes = await adminDb.quote.findMany({ where: { organizationId: orgId }, take: 400, orderBy: { createdAt: "asc" }, select: { id: true } });
    if ((await adminDb.approvalRequest.count({ where: { organizationId: orgId } })) < 150) {
      for (const q of quotes.slice(0, 300)) {
        if ((await adminDb.approvalRequest.count({ where: { organizationId: orgId } })) >= 150) break;
        await requestDiscountApproval(mgmt, q.id, 1, {}).catch(() => null);
      }
    }
    if ((await adminDb.savedView.count({ where: { organizationId: orgId } })) < 20) {
      for (let i = 0; i < 20; i++) await createView(contexts.SALES!, { entity: "leads", name: `Perf view ${i}` }).catch(() => null);
    }
    if ((await adminDb.chatChannel.count({ where: { organizationId: orgId } })) < 12) {
      for (let c = 0; c < 12; c++) {
        const ch = (await createChannel(mgmt, { kind: "PUBLIC", name: `perf-${c}` })) as any;
        const channelId = ch.id ?? ch.channel?.id;
        for (let m = 0; m < 500; m++) await postMessage(mgmt, channelId, { body: `Perf message ${c}-${m}` });
      }
    }
    if ((await adminDb.followUpSequence.count({ where: { organizationId: orgId } })) < 3) {
      for (let s = 0; s < 3; s++) await createSequence(mgmt, { name: `Perf sequence ${s}`, subjectType: "LEAD", steps: [{ dayOffset: 0, kind: "TASK", title: "Call" }, { dayOffset: 3, kind: "TASK", title: "Follow up" }] });
    }
    for (const month of ["2026-11", "2026-12"]) await setTarget(mgmt, { month, membershipId: null, amount: 5_000_000 }).catch(() => null);

    const count = (table: string) => adminDb.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id = '${orgId}'`).then((r) => r[0]!.n);
    for (const t of ["catalogue_items", "quotes", "quote_versions", "approval_requests", "saved_views", "chat_channels", "chat_messages", "follow_up_sequences", "deals"]) seeded[t] = await count(t);
    ids.quoteId = quotes[0]!.id;
    ids.channelId = (await adminDb.chatChannel.findFirstOrThrow({ where: { organizationId: orgId, name: "perf-0" } })).id;
    ids.dealId = (await adminDb.deal.findFirstOrThrow({ where: { organizationId: orgId } })).id;
    for (const r of discoverRoutes()) for (const m of r.methods) routes.set(`${m} ${r.path.replace("/api/orgs/{orgSlug}", "")}`, r);
  }

  const scenarios = (): Scenario[] => [
    { name: "Quotes list, first page (Management)", group: "list", role: "MANAGEMENT", key: "GET /quotes", query: "?pageSize=25" },
    { name: "Quotes list, first page (Sales)", group: "list", role: "SALES", key: "GET /quotes", query: "?pageSize=25" },
    { name: "Quotes list, deep page", group: "list", role: "MANAGEMENT", key: "GET /quotes", query: "?pageSize=25&page=12" },
    { name: "Quote detail with its versions", group: "detail", role: "MANAGEMENT", key: "GET /quotes/{quoteId}", params: { quoteId: ids.quoteId ?? "" } },
    { name: "Quote version with lines", group: "detail", role: "MANAGEMENT", key: "GET /quotes/{quoteId}/versions/{version}", params: { quoteId: ids.quoteId ?? "", version: "1" } },
    { name: "Approvals inbox (Management)", group: "list", role: "MANAGEMENT", key: "GET /approvals", query: "?pageSize=25" },
    { name: "Approvals inbox (Sales: own requests)", group: "list", role: "SALES", key: "GET /approvals", query: "?pageSize=25" },
    { name: "Catalogue", group: "list", role: "MANAGEMENT", key: "GET /catalogue", query: "?pageSize=50" },
    { name: "Forecast (Management)", group: "forecast", role: "MANAGEMENT", key: "GET /forecast" },
    { name: "Forecast (Sales: own)", group: "forecast", role: "SALES", key: "GET /forecast" },
    { name: "Forecast targets", group: "forecast", role: "MANAGEMENT", key: "GET /forecast/targets" },
    { name: "Pipelines", group: "list", role: "MANAGEMENT", key: "GET /pipelines" },
    { name: "Saved views (Sales)", group: "list", role: "SALES", key: "GET /views" },
    { name: "Sequences", group: "list", role: "MANAGEMENT", key: "GET /sequences" },
    { name: "Chat: channel list", group: "chat", role: "MANAGEMENT", key: "GET /chat/channels" },
    { name: "Chat: latest messages in a channel", group: "chat", role: "MANAGEMENT", key: "GET /chat/channels/{channelId}/messages", params: { channelId: ids.channelId ?? "" } },
    { name: "Chat: sync (the poll)", group: "chat", role: "MANAGEMENT", key: "GET /chat/sync" },
    { name: "Chat: unread totals", group: "chat", role: "SALES", key: "GET /chat/unread" },
    { name: "Assistant: context for a general question", group: "assistant", role: "MANAGEMENT", key: "service:assistant" },
    { name: "Assistant: context for a deal (Sales)", group: "assistant", role: "SALES", key: "service:assistant", params: { kind: "deal" } },
  ];

  async function call(s: Scenario) {
    if (s.key === "service:assistant") {
      const record = s.params?.kind === "deal" ? { kind: "deal" as const, id: ids.dealId! } : undefined;
      const started = performance.now();
      try {
        await askAssistant(contexts[s.role]!, slug, { question: "What needs attention?", record });
        return { status: 200, text: "", ms: performance.now() - started };
      } catch (e) {
        return { status: (e as { status?: number }).status ?? 500, text: String((e as Error).message), ms: performance.now() - started };
      }
    }
    const route = routes.get(s.key);
    if (!route) throw new Error(`No route ${s.key}`);
    current.ctx = contexts[s.role]!;
    const method = s.key.split(" ")[0] as "GET";
    return invoke(route, method, { orgSlug: slug, ...(s.params ?? {}) }, { query: s.query });
  }

  async function measure(s: Scenario): Promise<Result> {
    if (s.key === "service:assistant") await adminDb.assistantRequest.deleteMany({ where: { organizationId: orgId } }); // each scenario starts with an empty day
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
    return { scenario: s, p50: pct(times, 50), p95: pct(times, 95), max: times[times.length - 1]!, concurrentP95: pct(burst, 95), dbCalls, status: last.status, bytes: last.text.length, error: last.status >= 400 ? last.text.replace(/s+/g, " ").slice(0, 240) : undefined };
  }

  it("meets the response-time targets", async () => {
    await seedV11();
    setAssistantProviderFactory(async () => ({ id: "stub", complete: async () => ({ text: "Nothing needs attention.", toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 }, model: "stub" }) }));
    expect(seeded.quotes).toBeGreaterThanOrEqual(300);
    for (const s of scenarios().filter((x) => !process.env.PERF_ONLY || x.name.toLowerCase().includes(process.env.PERF_ONLY.toLowerCase()))) results.push(await measure(s));
    setAssistantProviderFactory(null);
    const failures = results.filter((r) => r.status >= 400 || r.p95 > TARGET_MS[r.scenario.group]);
    for (const r of results) {
      console.log(`${r.p95 > TARGET_MS[r.scenario.group] || r.status >= 400 ? "MISS" : "ok  "} ${r.scenario.name.padEnd(46)} p50 ${r.p50.toFixed(0).padStart(4)}  p95 ${r.p95.toFixed(0).padStart(4)}  c8 p95 ${r.concurrentP95.toFixed(0).padStart(4)}  db ${String(r.dbCalls).padStart(2)}  ${r.status}  ${r.bytes}B${r.error ? `  ERROR: ${r.error}` : ""}`);
    }
    if (process.env.PERF_WRITE) writeFileSync(process.env.PERF_RESULTS_V11 ?? "perf-v11-results.json", JSON.stringify({ seeded, results, targets: TARGET_MS }, null, 2));
    if (process.env.PERF_ASSERT !== "0") expect(failures.map((r) => r.scenario.name)).toEqual([]);
  }, 1_800_000);

  it("makes the same number of database calls for a page of 5 as for a page of 100 (no N+1)", async () => {
    if (!routes.size) await seedV11();
    const keys: [string, string][] = [["GET /quotes", "MANAGEMENT"], ["GET /approvals", "MANAGEMENT"], ["GET /catalogue", "MANAGEMENT"]];
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

  it("explains the hot queries with an index and not a table scan (the index review)", async () => {
    if (!orgId) await seedV11();
    const plans: Record<string, string> = {};
    // A table of a few hundred rows is rightly read whole. The question is whether an index exists that the planner can use: plan each query with
    // sequential scans switched off, and fail only when it still has to read the whole table.
    const explain = async (name: string, sql: string) => {
      const rows = await adminDb.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
        return tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN ${sql}`);
      });
      plans[name] = rows.map((r) => r["QUERY PLAN"]).join("\n");
    };
    await explain("quotes by organisation, newest first", `SELECT * FROM quotes WHERE organization_id = '${orgId}' ORDER BY created_at DESC LIMIT 25`);
    await explain("quote versions of a quote", `SELECT * FROM quote_versions WHERE organization_id = '${orgId}' AND quote_id = '${ids.quoteId}'`);
    await explain("pending approvals", `SELECT * FROM approval_requests WHERE organization_id = '${orgId}' AND status = 'PENDING' ORDER BY created_at DESC LIMIT 25`);
    await explain("chat messages in a channel", `SELECT * FROM chat_messages WHERE organization_id = '${orgId}' AND channel_id = '${ids.channelId}' ORDER BY seq DESC LIMIT 50`);
    const scans = Object.entries(plans).filter(([, plan]) => /Seq Scan/.test(plan)).map(([name]) => name);
    console.log(Object.entries(plans).map(([n, p]) => `--- ${n}\n${p}`).join("\n"));
    expect(scans, "these hot queries read the whole table: add an index").toEqual([]);
  }, 120_000);
});
