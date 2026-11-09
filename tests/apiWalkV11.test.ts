/**
 * G2.01 (FIG-1156): the generated authorization matrix of G1.02, run again on a V1.1 organisation.
 *
 * tests/apiWalk.test.ts walks every organisation route on a V1 organisation, where every V1.1 route answers "not available in your
 * release" to everybody, so it cannot say who may use quotes, approvals, the assistant, sequences, chat, mail or meetings. This walk
 * uses the same method (every route handler called as Management, Sales, Delivery, Finance and Restricted Technical, with a request built
 * from the route's own schema) on an organisation at release V1.1 with the assistant on and one real record of every V1.1 kind
 * (tests/helpers/worldV11.ts). What is checked:
 *
 *   - every route has a row, and the rows equal the reviewed matrix in src/api/contract/accessMatrixV11.json;
 *   - (the role rules and the V1 regression check read the reviewed matrix: tests/accessMatrixV11Rules.test.ts, which runs in seconds)
 *   - the rules that hold whatever the matrix says: no server errors, an explained refusal on every 403, no deal value, margin, cost
 *     or payment in an answer for a role that may not see it (the chat cards and quote lines included), and 401 when signed out.
 *
 * Regenerate after an intended change:  UPDATE_API_SNAPSHOTS=1 npx vitest run tests/apiWalkV11.test.ts
 * That also rewrites docs/PERMISSION_MATRIX_REPORT_V1_1.md. Review the diff before committing it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import type { AuthContext } from "../src/auth/context";
import { hasPermission } from "../src/auth/context";
import { inferSchema } from "../src/api/jsonSchema";

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
vi.mock("../src/app/api/_lib/validation", async () => (await import("./helpers/validationCapture")).capturingValidation());

import { discoverRoutes, fillParams, invoke, isOrganisationRoute } from "./helpers/routeHarness";
import { bodyHints, walkRoute } from "./helpers/routeWalker";
import { idFor, ROLE_KEYS, SENTINEL_PATTERNS, type RoleKey } from "./helpers/world";
import { createStabiliser } from "./helpers/stable";
import { buildWorldV11, type WorldV11 } from "./helpers/worldV11";

const GOLDEN = "src/api/contract/accessMatrixV11.json";
const V1_GOLDEN = "src/api/contract/accessMatrix.json";
const REPORT = "docs/PERMISSION_MATRIX_REPORT_V1_1.md";
const SCHEMAS = "src/api/contract/routeSchemasV11.json";
const SHAPES = "src/api/contract/responseShapesV11.json";
const EXAMPLES = "src/api/contract/examplesV11.json";
const UPDATE = process.env.UPDATE_API_SNAPSHOTS === "1";

/** Roles with nothing to lose go first, so a mutation by a role that is allowed cannot change what a refused role would have seen. */
const WALK_ORDER: RoleKey[] = ["RESTRICTED_TECHNICAL", "DELIVERY", "FINANCE", "SALES", "MANAGEMENT"];

/** Distinctive cost and margin figures of the V1.1 world's catalogue item (18 500 price, 11 000 cost): a role without the margin permission must never see the cost. */
const COST_PATTERN = /\b11[,\s]?000(\.0+)?\b/;

function letter(status: number): string {
  if (status === 401) return "U";
  if (status === 403) return "D";
  if (status === 404) return "H";
  if (status === 400) return "V";
  if (status >= 500) return "E";
  if (status === 429) return "R";
  return status < 300 || status === 409 || status === 422 ? "A" : "?";
}

const readJson = <T>(path: string): T | null => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null);
function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

describe("generated authorization matrix on a V1.1 organisation (G2.01)", () => {
  let world: WorldV11;
  const cells: Record<string, string> = {};
  const unexplained: string[] = [];
  const unavailable = new Set<string>();
  const leaks: string[] = [];
  const serverErrors: string[] = [];
  // What the contract is built from (src/api/derivedOperations.ts): the request schemas each route validated against, the shape and an example of each answer.
  const requestSchemas: Record<string, { body?: unknown; query?: unknown }> = {};
  const examples: Record<string, Partial<Record<RoleKey, unknown>>> = {};
  const shapes: Record<string, unknown> = {};

  beforeAll(async () => {
    world = await buildWorldV11("WalkV11");
    expect(world.missing, "the V1.1 organisation must build completely").toEqual([]);
    let hints = await bodyHints(world);
    const routes = discoverRoutes().filter(isOrganisationRoute);
    const jobs = routes.flatMap((route) => route.methods.map((method) => ({ route, method }))).sort((a, b) => Number(a.method !== "GET") - Number(b.method !== "GET") || a.route.path.localeCompare(b.route.path));
    let dirty = false;
    const stable = createStabiliser();
    const canSeeDealValue = (ctx: AuthContext) => hasPermission(ctx, "deals.view.value") || ctx.membershipId === world.ctx.SALES.membershipId;
    const canSeePayments = (ctx: AuthContext) => hasPermission(ctx, "finance.view.payments");
    const canSeeCost = (ctx: AuthContext) => hasPermission(ctx, "deals.margin") || hasPermission(ctx, "catalogue.manage");

    for (const { route, method } of jobs) {
      // A walk that changed things must not colour the next route: start again from a clean organisation.
      if (method !== "GET" && dirty) {
        world = await buildWorldV11("WalkV11");
        hints = await bodyHints(world);
        dirty = false;
      }
      const key = `${method} ${route.path}`;
      const row: Record<string, string> = {};
      for (const role of WALK_ORDER) {
        const ctx = world.ctx[role];
        current.ctx = ctx;
        const values = fillParams(route, world.organization.slug, (n) => idFor(world, route.path, n));
        const res = await walkRoute(route, method, values, hints);
        row[role] = letter(res.status);
        if (method !== "GET" && res.status < 300) dirty = true;
        if (res.status >= 500) serverErrors.push(`${role} ${key} -> ${res.status} ${res.code ?? ""}`);
        if (res.status === 403 && res.code === "FEATURE_UNAVAILABLE") {
          if (!res.json?.message || !res.json?.requestId) unexplained.push(`${role} ${key}: release refusal without message or request id`);
          if (role === "MANAGEMENT") unavailable.add(key);
        } else if (res.status === 403) {
          const d = res.json?.denial;
          const ok = res.code === "FORBIDDEN" && res.json?.message && res.json?.requestId && d && typeof d.yourRole === "string" && Array.isArray(d.ownerRoles) && Array.isArray(d.whoToAsk);
          if (!ok) unexplained.push(`${role} ${key}: ${JSON.stringify(res.json).slice(0, 160)}`);
        }
        if (!canSeeDealValue(ctx) && SENTINEL_PATTERNS.dealValue.test(res.text)) leaks.push(`${role} ${key} shows a deal value`);
        if (!canSeePayments(ctx) && (SENTINEL_PATTERNS.invoiceAmount.test(res.text) || SENTINEL_PATTERNS.invoiceNumber.test(res.text))) leaks.push(`${role} ${key} shows a payment`);
        if (!canSeeCost(ctx) && res.status < 300 && COST_PATTERN.test(res.text)) leaks.push(`${role} ${key} shows a cost or margin figure`);
        if (res.bodySchema || res.querySchema) {
          const entry = (requestSchemas[key] ??= {});
          const { z } = await import("zod");
          const toJson = (schema: z.ZodType) => z.toJSONSchema(schema, { io: "input", unrepresentable: "any", target: "draft-2020-12" });
          if (res.bodySchema && !entry.body) entry.body = toJson(res.bodySchema);
          if (res.querySchema && !entry.query) entry.query = toJson(res.querySchema);
        }
        if (res.status < 300 && res.json !== null) {
          (examples[key] ??= {})[role] = stable.value(res.json);
          shapes[`${key}|${role}`] = inferSchema(stable.value(res.json));
        } else if (res.status < 300 && route.path.includes("export") && res.text) {
          (examples[key] ??= {})[role] = stable.text(res.text.split("\n").slice(0, 3).join("\n"));
        }
      }
      cells[key] = ROLE_KEYS.map((r) => row[r]).join("");
    }
  }, 2_400_000);

  it("has a row for every route and method on disk", () => {
    const onDisk = discoverRoutes()
      .filter(isOrganisationRoute)
      .flatMap((r) => r.methods.map((m) => `${m} ${r.path}`))
      .sort();
    expect(Object.keys(cells).sort()).toEqual(onDisk);
  });

  it("equals the reviewed matrix (src/api/contract/accessMatrixV11.json)", () => {
    if (UPDATE) {
      writeJson(GOLDEN, { roles: ROLE_KEYS, release: "v1.1", legend: { A: "reached", D: "403", H: "404", V: "400", E: "5xx", U: "401" }, rows: Object.fromEntries(Object.entries(cells).sort()) });
      writeReport(cells, readJson<{ rows: Record<string, string> }>(V1_GOLDEN)?.rows ?? {});
      writeJson(SCHEMAS, Object.fromEntries(Object.entries(requestSchemas).sort()));
      writeJson(SHAPES, buildShapes(shapes));
      writeJson(EXAMPLES, buildExamples(examples));
      return;
    }
    const golden = readJson<{ rows: Record<string, string> }>(GOLDEN);
    expect(golden, "run once with UPDATE_API_SNAPSHOTS=1 to create the matrix").not.toBeNull();
    const diff: string[] = [];
    for (const key of new Set([...Object.keys(golden!.rows), ...Object.keys(cells)])) {
      if (golden!.rows[key] !== cells[key]) diff.push(`${key}: reviewed ${golden!.rows[key] ?? "(none)"}, now ${cells[key] ?? "(none)"}`);
    }
    expect(diff, `Roles are ${ROLE_KEYS.join(", ")}. Review the change, then regenerate with UPDATE_API_SNAPSHOTS=1`).toEqual([]);
  });

  it("never answers with a server error", () => expect(serverErrors).toEqual([]));
  it("explains every refusal: the role, the roles that own the area, and who to ask", () => expect(unexplained).toEqual([]));
  it("never shows a deal value, a payment or a cost to a role that may not see it, on any route", () => expect(leaks).toEqual([]));

  it("opens every V1.1 route to Management: a V1.1 organisation gets no release refusal on a V1.1 feature", () => {
    // Nothing in a V1.1 organisation may answer "not available in your release" (the V2 routes, webhooks and API tokens, are not built).
    expect([...unavailable].sort()).toEqual([]);
  });

  describe("signed out", () => {
    it("is answered 401 with the error envelope by every route", async () => {
      current.ctx = null;
      const bad: string[] = [];
      for (const route of discoverRoutes().filter(isOrganisationRoute)) {
        for (const method of route.methods) {
          const values = fillParams(route, world.organization.slug, (n) => idFor(world, route.path, n));
          const res = await invoke(route, method, values);
          if (res.status !== 401 || res.code !== "UNAUTHORIZED" || !res.json?.requestId) bad.push(`${method} ${route.path} -> ${res.status} ${res.code}`);
        }
      }
      expect(bad).toEqual([]);
    }, 300_000);
  });
});

function writeReport(cells: Record<string, string>, v1: Record<string, string>) {
  const short: Record<string, string> = { MANAGEMENT: "Mgmt", SALES: "Sales", DELIVERY: "Deliv", FINANCE: "Fin", RESTRICTED_TECHNICAL: "RT" };
  const added = Object.keys(cells).filter((k) => !(k in v1));
  const gated = Object.keys(cells).filter((k) => k in v1 && v1[k] === "DDDDD" && cells[k] !== "DDDDD");
  const lines = [
    "# Permission matrix report, V1.1 organisation (G2.01)",
    "",
    "Generated by `tests/apiWalkV11.test.ts`: every organisation route called as each role against one seeded organisation at release V1.1, with the",
    "assistant on and one real record of every V1.1 kind (`tests/helpers/worldV11.ts`). Do not edit by hand; regenerate with",
    "`UPDATE_API_SNAPSHOTS=1 npx vitest run tests/apiWalkV11.test.ts` after an intended permission change and review the diff.",
    "The V1 organisation matrix is in `docs/PERMISSION_MATRIX_REPORT.md` (V1.1 routes are all D there: not in the release).",
    "",
    "| Letter | Meaning |",
    "|---|---|",
    "| A | Reached: the permission check passed and the route answered (a business rule may still refuse the request). |",
    "| D | Refused with 403 and an explained no-access envelope (your role, the roles that own the area, who to ask). |",
    "| H | 404: the record exists but this role may not open it, so it is hidden rather than refused. |",
    "| V | 400 after a valid-shaped request: the request failed a rule before access could be judged. |",
    "",
    `Routes new since the V1 matrix: ${added.length}. Routes closed in a V1 organisation that this walk opens: ${gated.length}.`,
    "",
    `| Route | ${ROLE_KEYS.map((r) => short[r]).join(" | ")} | In V1 matrix |`,
    `|---|${ROLE_KEYS.map(() => ":-:").join("|")}|:-:|`,
  ];
  for (const [key, row] of Object.entries(cells).sort((a, b) => a[0].split(" ")[1]!.localeCompare(b[0].split(" ")[1]!) || a[0].localeCompare(b[0]))) {
    const mark = !(key in v1) ? "new" : v1[key] === "DDDDD" && row !== "DDDDD" ? "opened" : v1[key] === row ? "same" : "changed";
    lines.push(`| \`${key.replace("/api/orgs/{orgSlug}", "")}\` | ${[...row].join(" | ")} | ${mark} |`);
  }
  const counts: Record<string, number> = {};
  for (const row of Object.values(cells)) for (const l of row) counts[l] = (counts[l] ?? 0) + 1;
  lines.push("", `${Object.keys(cells).length} route and method pairs, ${Object.values(counts).reduce((a, b) => a + b, 0)} role answers: ${Object.entries(counts).map(([l, n]) => `${l} ${n}`).join(", ")}.`, "");
  mkdirSync("docs", { recursive: true });
  writeFileSync(REPORT, lines.join("\n"));
}

/** One response shape per route: the Management answer when there is one, else the first role that got an answer. */
function buildShapes(shapes: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [composite, shape] of Object.entries(shapes).sort()) {
    const [key, role] = composite.split("|") as [string, RoleKey];
    if (!(key in out) || role === "MANAGEMENT") out[key] = shape;
  }
  return out;
}

/** Examples per route: `default` is Management's answer (else the first), `same` the roles that got exactly it, and a role is listed on its own when its answer differs (masked, or its own records). */
function buildExamples(examples: Record<string, Partial<Record<RoleKey, unknown>>>) {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, byRole] of Object.entries(examples).sort()) {
    const first = byRole.MANAGEMENT ?? Object.values(byRole)[0];
    // `same` names the roles whose real answer equals `default`; any other role is listed separately, or has no recorded answer.
    const same: string[] = [];
    const entry: Record<string, unknown> = { default: first, same };
    for (const role of ROLE_KEYS) {
      if (!(role in byRole)) continue;
      if (JSON.stringify(byRole[role]) === JSON.stringify(first)) same.push(role);
      else entry[role] = byRole[role];
    }
    out[key] = entry;
  }
  return out;
}

