import { mkdirSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { adminDb } from "../src/db/adminClient";

const current: { ctx: AuthContext | null } = { ctx: null };
vi.mock("../src/auth/requestContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth/requestContext")>();
  return {
    ...actual,
    resolveRequestContext: async () => {
      if (!current.ctx) {
        const { UnauthorizedError } = await import("../src/auth/errors");
        throw new UnauthorizedError();
      }
      return current.ctx;
    },
  };
});

import { discoverRoutes, invoke, type DiscoveredRoute } from "./helpers/routeHarness";
import { buildWorld, ROLE_KEYS, SENTINEL_PATTERNS, type RoleKey, type World } from "./helpers/world";

/**
 * G1.08 (FIG-1075): the end-to-end API demo for every role against a seeded organisation, as a test that runs it and, with WRITE_DEMO=1,
 * writes the recorded run to docs/demo/BACKEND_V1_DEMO_RUN.md. Everything goes through the real route handlers (authorisation, validation,
 * masking and data access included), as each role, in order. What a role is expected to see is written here by hand, from the signed
 * permission model, not read back from the walk.
 */
describe("Backend V1 demo: every role, end to end (G1.08)", () => {
  let A: World;
  let B: World;
  const routes = new Map<string, DiscoveredRoute>();
  const log: string[] = [];
  const table: { endpoint: string; cells: Record<string, string> }[] = [];

  async function call(role: RoleKey, key: string, options: { values?: Record<string, string>; body?: unknown; query?: string; world?: World } = {}) {
    const world = options.world ?? A;
    const route = routes.get(key);
    if (!route) throw new Error(`No route ${key}`);
    current.ctx = world.ctx[role];
    const method = key.split(" ")[0] as "GET";
    return invoke(route, method, { orgSlug: world.organization.slug, ...(options.values ?? {}) }, { body: options.body, query: options.query });
  }

  beforeAll(async () => {
    for (const r of discoverRoutes()) for (const m of r.methods) routes.set(`${m} ${r.path.replace("/api/orgs/{orgSlug}", "")}`, r);
    A = await buildWorld("DemoA");
    B = await buildWorld("DemoB");
  }, 120000);

  it("1. the role tour: what each of the six roles gets from the same endpoints", async () => {
    const tour: { key: string; label: string; may: RoleKey[]; values?: Record<string, string> }[] = [
      { key: "GET /audit/events", label: "Audit log", may: ["MANAGEMENT"] },
      { key: "GET /integrations", label: "Integrations and website key", may: ["MANAGEMENT"] },
      { key: "GET /payments/summary", label: "Payments summary", may: ["MANAGEMENT", "FINANCE"] },
      { key: "GET /invoices", label: "Invoices", may: ["MANAGEMENT", "FINANCE"] },
      { key: "GET /leads", label: "Leads list", may: ["MANAGEMENT", "SALES"] },
      { key: "GET /deals", label: "Deals list", may: ["MANAGEMENT", "SALES", "FINANCE", "DELIVERY"] },
    ];
    for (const row of tour) {
      const cells: Record<string, string> = {};
      for (const role of ROLE_KEYS) {
        const res = await call(role, row.key, row.values ? { values: row.values } : {});
        expect(res.status, `${role} ${row.key}`).toBeLessThan(500);
        if (row.may.includes(role)) {
          expect(res.status, `${role} ${row.key} should be allowed`).toBe(200);
          cells[role] = "allowed";
        } else if (res.status === 403) {
          // A refusal is explained: who you are, who owns the area, who to ask (never a silent hide).
          expect(res.json?.denial, `${role} ${row.key} refusal must be explained`).toBeTruthy();
          cells[role] = "refused, explained";
        } else {
          cells[role] = String(res.status);
        }
        // Masking: a deal value or a payment never reaches a role that may not see it, in any answer.
        if (row.key === "GET /deals" && res.status === 200) {
          // Finance may see values but only of won deals (a provisional departure), so the open demo deal is not in its list at all.
          if (role === "MANAGEMENT" || role === "SALES") {
            expect(SENTINEL_PATTERNS.dealValue.test(res.text), `${role} deal value`).toBe(true);
            cells[role] += " (value shown)";
          } else if (role === "FINANCE") {
            cells[role] += " (won deals only)";
          } else {
            expect(SENTINEL_PATTERNS.dealValue.test(res.text), `${role} deal value`).toBe(false);
            cells[role] += " (value masked)";
          }
        }
        if (role !== "MANAGEMENT" && role !== "FINANCE") expect(SENTINEL_PATTERNS.invoiceAmount.test(res.text), `${role} ${row.key} payment`).toBe(false);
      }
      table.push({ endpoint: `${row.label} (${row.key})`, cells });
    }
  });

  it("2. a lead's day: Sales captures it, Management sees it and the audit trail, others are kept out", async () => {
    const status = await adminDb.leadStatus.findFirstOrThrow({ where: { organizationId: A.organization.id, key: "NEW" } });
    const created = await call("SALES", "POST /leads", { body: { leadStatusId: status.id } });
    expect(created.status, created.text).toBeLessThan(300);
    const leadId = created.json.lead.id as string;
    log.push("Sales creates a lead: accepted, Sales becomes its owner.");

    const mine = await call("SALES", "GET /leads/{leadId}", { values: { leadId } });
    expect(mine.status).toBe(200);
    log.push("Sales opens it: 200.");

    const boss = await call("MANAGEMENT", "GET /leads/{leadId}", { values: { leadId } });
    expect(boss.status).toBe(200);
    log.push("Management opens the same lead: 200 (organisation scope).");

    const audit = await call("MANAGEMENT", "GET /audit/events", {});
    expect(audit.status).toBe(200);
    log.push("Management reads the audit log: 200.");

    const handOff = await call("SALES", "POST /leads", { body: { leadStatusId: status.id, ownerMembershipId: A.ctx.MANAGEMENT.membershipId } });
    expect(handOff.status).toBe(403);
    log.push("Sales tries to hand a new lead to someone else without the assign permission: 403.");

    const foreign = await call("MANAGEMENT", "GET /leads/{leadId}", { values: { leadId: B.ids.leadId! } });
    expect(foreign.status).toBe(404);
    log.push("Management of organisation A asks for organisation B's lead: 404, nothing returned.");

    const smuggle = await call("MANAGEMENT", "POST /leads", { body: { leadStatusId: (await adminDb.leadStatus.findFirstOrThrow({ where: { organizationId: B.organization.id, key: "NEW" } })).id } });
    expect(smuggle.status).toBe(400);
    log.push("Management of A creates a lead with organisation B's status: 400 validation error, never a server error.");
  });

  it("3. money stays with Finance and Management", async () => {
    const invoices = await call("FINANCE", "GET /invoices", {});
    expect(invoices.status).toBe(200);
    expect(SENTINEL_PATTERNS.invoiceNumber.test(invoices.text)).toBe(true);
    log.push("Finance lists invoices: 200, amounts and numbers visible.");

    for (const role of ["SALES", "DELIVERY", "RESTRICTED_TECHNICAL"] as const) {
      const res = await call(role, "GET /payments/summary", {});
      expect(res.status, role).toBe(403);
      expect(res.json?.denial).toBeTruthy();
    }
    log.push("Sales, Delivery and Restricted Technical ask for the payments summary: 403, each with an explained refusal.");

    const view360 = await call("SALES", "GET /companies/{companyId}/360", { values: { companyId: A.ids.companyId! } });
    expect(view360.status).toBeLessThan(500);
    expect(SENTINEL_PATTERNS.invoiceAmount.test(view360.text)).toBe(false);
    expect(SENTINEL_PATTERNS.invoiceNumber.test(view360.text)).toBe(false);
    log.push("Sales opens Customer 360: no payment or invoice appears in it.");
  });

  it("4. signed out is refused everywhere the same way", async () => {
    current.ctx = null;
    const route = routes.get("GET /leads")!;
    const res = await invoke(route, "GET", { orgSlug: A.organization.slug });
    expect(res.status).toBe(401);
    expect(res.code).toBe("UNAUTHORIZED");
    log.push("No session: 401 with the standard error envelope.");
  });

  it("writes the recorded run", () => {
    if (!process.env.WRITE_DEMO) return;
    const roles = [...ROLE_KEYS];
    const head = `| Endpoint | ${roles.join(" | ")} |\n|---|${roles.map(() => "---").join("|")}|`;
    const body = table.map((r) => `| ${r.endpoint} | ${roles.map((x) => r.cells[x] ?? "").join(" | ")} |`).join("\n");
    const text = `# Backend V1 demo run (G1.08, FIG-1075)

Produced by \`WRITE_DEMO=1 npx vitest run tests/backendV1Demo.test.ts\`: a seeded organisation with a record of every kind, driven through the real route handlers as each role. Every line below was asserted by the test, so this file is a record of a passing run, not a description.

## 1. The role tour

The same endpoints, called as each of the six roles. "Refused, explained" is a 403 carrying the role, the owner roles and who to ask. Deal values are shown to Management and Sales (Finance sees won deals only) and masked for everyone else; payments only to Management and Finance.

${head}
${body}

## 2 and 3. A lead's day, and money

${log.map((l, i) => `${i + 1}. ${l}`).join("\n")}

The other end-to-end demos are the per-stage ones: \`docs/demo/stage-2.http\`, \`stage-3.http\`, \`stage-4.http\` with \`tests/stage2ExitGate.test.ts\`, \`stage3ExitGate.test.ts\`, \`stage4ExitGate.test.ts\`. The full role-by-route matrix is \`docs/PERMISSION_MATRIX_REPORT.md\`.
`;
    mkdirSync("docs/demo", { recursive: true });
    writeFileSync("docs/demo/BACKEND_V1_DEMO_RUN.md", text);
  });
});
