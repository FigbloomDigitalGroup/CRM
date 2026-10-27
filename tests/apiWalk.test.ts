/**
 * G1.02 (FIG-1069) and the recording side of G1.06 (FIG-1073): one generated walk over every organisation route, as each role.
 *
 * Every route handler on disk is called as Management, Sales, Delivery, Finance, Restricted Technical and Customer Support against
 * one seeded organisation (tests/helpers/world.ts), with a request built from the route's own schema. Each answer becomes one
 * letter, and the six letters per route are the permission matrix:
 *
 *   A reached and answered   D refused with 403   H not found (hidden)   V refused as invalid   E server error   U not signed in
 *
 * What is checked:
 *   - every route has a row, and the rows equal the reviewed matrix in src/api/contract/accessMatrix.json
 *     (a new route, or a changed permission, fails until the matrix is regenerated and reviewed);
 *   - the rules that must hold whatever the matrix says: Management-only areas, payments, no server errors, and an explained
 *     refusal (role, owners, who to ask) on every 403;
 *   - deal values and payments never appear in any answer for a role that may not see them (the sentinel scan);
 *   - signed out, every route answers 401.
 *
 * Regenerate after an intended change:  UPDATE_API_SNAPSHOTS=1 npx vitest run tests/apiWalk.test.ts
 * That also rewrites docs/PERMISSION_MATRIX_REPORT.md and the contract snapshots in src/api/contract/.
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
import { createStabiliser } from "./helpers/stable";
import { buildWorld, idFor, ROLE_KEYS, SENTINEL_PATTERNS, type RoleKey, type World } from "./helpers/world";
import { MANAGEMENT_EXCLUDED, MANAGEMENT_ONLY, PAYMENTS_ONLY, ROLE_FAMILIES } from "./fixtures/roleFamilies";

const GOLDEN = "src/api/contract/accessMatrix.json";
const REPORT = "docs/PERMISSION_MATRIX_REPORT.md";
const SCHEMAS = "src/api/contract/routeSchemas.json";
const SHAPES = "src/api/contract/responseShapes.json";
const EXAMPLES = "src/api/contract/examples.json";
const UPDATE = process.env.UPDATE_API_SNAPSHOTS === "1";

/** Roles with nothing to lose go first, so a mutation by a role that is allowed cannot change what a refused role would have seen. */
const WALK_ORDER: RoleKey[] = ["RESTRICTED_TECHNICAL", "CUSTOMER_SUPPORT", "DELIVERY", "FINANCE", "SALES", "MANAGEMENT"];

function letter(status: number): string {
  if (status === 401) return "U";
  if (status === 403) return "D";
  if (status === 404) return "H";
  if (status === 400) return "V";
  if (status >= 500) return "E";
  if (status === 429) return "R";
  return status < 300 || status === 409 || status === 422 ? "A" : "?";
}

interface Walked {
  cells: Record<string, string>;
  unexplained: string[];
  leaks: string[];
  serverErrors: string[];
  requestSchemas: Record<string, { body?: unknown; query?: unknown }>;
  examples: Record<string, Partial<Record<RoleKey, unknown>>>;
  shapes: Record<string, unknown>;
  synthesizedCount: number;
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
}

const rolesWithLetter = (row: string, wanted: (l: string) => boolean): RoleKey[] => ROLE_KEYS.filter((_, i) => wanted(row[i]!));
const reached = (l: string) => l !== "D" && l !== "U";

describe("generated authorization matrix (G1.02)", () => {
  let world: World;
  let walked: Walked;
  let routeCount = 0;

  beforeAll(async () => {
    world = await buildWorld("Walk");
    expect(world.missing, "the seeded organisation must build completely").toEqual([]);
    let hints = await bodyHints(world);
    const routes = discoverRoutes().filter(isOrganisationRoute);
    routeCount = routes.reduce((n, r) => n + r.methods.length, 0);
    const jobs = routes.flatMap((route) => route.methods.map((method) => ({ route, method }))).sort((a, b) => Number(a.method !== "GET") - Number(b.method !== "GET") || a.route.path.localeCompare(b.route.path));

    walked = { cells: {}, unexplained: [], leaks: [], serverErrors: [], requestSchemas: {}, examples: {}, shapes: {}, synthesizedCount: 0 };
    const stable = createStabiliser();
    let dirty = false;
    const canSeeDealValue = (ctx: AuthContext) => hasPermission(ctx, "deals.view.value") || ctx.membershipId === world.ctx.SALES.membershipId;
    const canSeePayments = (ctx: AuthContext) => hasPermission(ctx, "finance.view.payments");

    for (const { route, method } of jobs) {
      // A walk that changed things (archived a lead, removed a member) must not colour the next route: start again from a clean organisation.
      if (method !== "GET" && dirty) {
        world = await buildWorld("Walk");
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
        if (res.synthesized) walked.synthesizedCount++;
        if (method !== "GET" && res.status < 300) dirty = true;

        if (res.status >= 500) walked.serverErrors.push(`${role} ${key} -> ${res.status} ${res.code ?? ""}`);
        if (res.status === 403) {
          const d = res.json?.denial;
          const ok = res.code === "FORBIDDEN" && res.json?.message && res.json?.requestId && d && typeof d.yourRole === "string" && Array.isArray(d.ownerRoles) && Array.isArray(d.whoToAsk);
          if (!ok) walked.unexplained.push(`${role} ${key}: ${JSON.stringify(res.json).slice(0, 160)}`);
        }
        if (!canSeeDealValue(ctx) && SENTINEL_PATTERNS.dealValue.test(res.text)) walked.leaks.push(`${role} ${key} shows a deal value`);
        if (!canSeePayments(ctx) && (SENTINEL_PATTERNS.invoiceAmount.test(res.text) || SENTINEL_PATTERNS.invoiceNumber.test(res.text))) walked.leaks.push(`${role} ${key} shows a payment`);

        if (res.bodySchema || res.querySchema) {
          const entry = (walked.requestSchemas[key] ??= {});
          const { z } = await import("zod");
          const toJson = (schema: z.ZodType) => z.toJSONSchema(schema, { io: "input", unrepresentable: "any", target: "draft-2020-12" });
          if (res.bodySchema && !entry.body) entry.body = toJson(res.bodySchema);
          if (res.querySchema && !entry.query) entry.query = toJson(res.querySchema);
        }
        if (res.status < 300 && res.json !== null) {
          (walked.examples[key] ??= {})[role] = stable.value(res.json);
          walked.shapes[`${key}|${role}`] = inferSchema(stable.value(res.json));
        } else if (res.status < 300 && route.path.includes("export") && res.text) {
          (walked.examples[key] ??= {})[role] = stable.text(res.text.split("\n").slice(0, 3).join("\n"));
        }
      }
      walked.cells[key] = ROLE_KEYS.map((r) => row[r]).join("");
    }
  }, 1_800_000);

  it("has a row for every route and method on disk", () => {
    const onDisk = discoverRoutes()
      .filter(isOrganisationRoute)
      .flatMap((r) => r.methods.map((m) => `${m} ${r.path}`))
      .sort();
    expect(Object.keys(walked.cells).sort()).toEqual(onDisk);
    expect(routeCount).toBeGreaterThan(300);
  });

  it("equals the reviewed matrix (src/api/contract/accessMatrix.json)", () => {
    if (UPDATE) {
      writeJson(GOLDEN, { roles: ROLE_KEYS, legend: { A: "reached", D: "403", H: "404", V: "400", E: "5xx", U: "401" }, rows: Object.fromEntries(Object.entries(walked.cells).sort()) });
      writeReport(walked.cells);
      writeJson(SCHEMAS, Object.fromEntries(Object.entries(walked.requestSchemas).sort()));
      writeJson(SHAPES, buildShapes(walked.shapes));
      writeJson(EXAMPLES, buildExamples(walked.examples));
      return;
    }
    const golden = readJson<{ rows: Record<string, string> }>(GOLDEN);
    expect(golden, "run once with UPDATE_API_SNAPSHOTS=1 to create the matrix").not.toBeNull();
    const diff: string[] = [];
    for (const key of new Set([...Object.keys(golden!.rows), ...Object.keys(walked.cells)])) {
      if (golden!.rows[key] !== walked.cells[key]) diff.push(`${key}: reviewed ${golden!.rows[key] ?? "(none)"}, now ${walked.cells[key] ?? "(none)"}`);
    }
    expect(diff, `Roles are ${ROLE_KEYS.join(", ")}. Review the change, then regenerate with UPDATE_API_SNAPSHOTS=1`).toEqual([]);
  });

  it("keeps the request schemas the contract is built from (src/api/contract/routeSchemas.json)", () => {
    if (UPDATE) return;
    const stored = readJson<Record<string, unknown>>(SCHEMAS);
    expect(stored, "run once with UPDATE_API_SNAPSHOTS=1 to create the schema snapshot").not.toBeNull();
    const now = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(walked.requestSchemas).sort())));
    // Only the routes that reached validation as someone are recorded; a route that now records nothing has lost its schema.
    const lost = Object.keys(stored!).filter((k) => !(k in now));
    const changed = Object.keys(now).filter((k) => JSON.stringify(stored![k]) !== JSON.stringify(now[k]));
    expect({ lost, changed }, "a route's request shape changed: regenerate with UPDATE_API_SNAPSHOTS=1 and add a note to docs/API_CHANGELOG.md").toEqual({ lost: [], changed: [] });
  });

  it("never answers with a server error", () => {
    expect(walked.serverErrors).toEqual([]);
  });

  it("explains every refusal: the role, the roles that own the area, and who to ask", () => {
    expect(walked.unexplained).toEqual([]);
  });

  it("never shows a deal value or a payment to a role that may not see it, on any route", () => {
    expect(walked.leaks).toEqual([]);
  });

  describe("rules that hold whatever the matrix says", () => {
    const rows = () => Object.entries(walked.cells);

    it("keeps the Management-only areas to Management", () => {
      const bad = rows()
        .filter(([key]) => MANAGEMENT_ONLY.some((re) => re.test(key)))
        .flatMap(([key, row]) => rolesWithLetter(row, reached).filter((r) => r !== "MANAGEMENT").map((r) => `${r} reached ${key}`));
      expect(bad).toEqual([]);
    });

    it("keeps invoices, payments and the deal payment note to Finance and Management", () => {
      const bad = rows()
        .filter(([key]) => PAYMENTS_ONLY.some((re) => re.test(key)))
        .flatMap(([key, row]) => rolesWithLetter(row, reached).filter((r) => r !== "MANAGEMENT" && r !== "FINANCE").map((r) => `${r} reached ${key}`));
      expect(bad).toEqual([]);
    });

    it("lets each role reach only the areas that role is meant to work in", () => {
      const bad: string[] = [];
      for (const [key, row] of rows()) {
        ROLE_KEYS.forEach((role, i) => {
          if (role === "MANAGEMENT" || !reached(row[i]!)) return;
          const allowed = ROLE_FAMILIES[role as Exclude<RoleKey, "MANAGEMENT">];
          if (!allowed.some((re) => re.test(key))) bad.push(`${role} reached ${key}`);
        });
      }
      expect(bad).toEqual([]);
    });

    it("gives Management a way into every route it is not deliberately kept out of", () => {
      const locked = rows().filter(([key, row]) => row[0] === "D" && !(key in MANAGEMENT_EXCLUDED)).map(([key]) => key);
      expect(locked).toEqual([]);
    });

    it("leaves Customer Support with only what every member has in V1 (the role is behind a flag that is off)", () => {
      // Covered by the role-families check above; this one names the rule so a failure reads as what it is.
      const open = rows().filter(([key, row]) => reached(row[5]!) && !ROLE_FAMILIES.CUSTOMER_SUPPORT.some((re) => re.test(key))).map(([key]) => key);
      expect(open).toEqual([]);
    });
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

function writeReport(cells: Record<string, string>) {
  const short: Record<string, string> = { MANAGEMENT: "Mgmt", SALES: "Sales", DELIVERY: "Deliv", FINANCE: "Fin", RESTRICTED_TECHNICAL: "RT", CUSTOMER_SUPPORT: "CS" };
  const lines = [
    "# Permission matrix report (G1.02)",
    "",
    "Generated by `tests/apiWalk.test.ts`: every organisation route called as each role against one seeded organisation. Do not edit by hand;",
    "regenerate with `UPDATE_API_SNAPSHOTS=1 npx vitest run tests/apiWalk.test.ts` after an intended permission change and review the diff.",
    "",
    "| Letter | Meaning |",
    "|---|---|",
    "| A | Reached: the permission check passed and the route answered (a business rule may still refuse the request). |",
    "| D | Refused with 403 and an explained no-access envelope (your role, the roles that own the area, who to ask). |",
    "| H | 404: the record exists but this role may not open it, so it is hidden rather than refused. |",
    "| V | 400 after a valid-shaped request: the request failed a rule before access could be judged. |",
    "",
    "Customer Support is the proposed sixth role, off until the organisation switches it on, so it has no access in V1.",
    "",
    `| Route | ${ROLE_KEYS.map((r) => short[r]).join(" | ")} |`,
    `|---|${ROLE_KEYS.map(() => ":-:").join("|")}|`,
  ];
  for (const [key, row] of Object.entries(cells).sort((a, b) => a[0].split(" ")[1]!.localeCompare(b[0].split(" ")[1]!) || a[0].localeCompare(b[0]))) {
    lines.push(`| \`${key.replace("/api/orgs/{orgSlug}", "")}\` | ${[...row].join(" | ")} |`);
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
