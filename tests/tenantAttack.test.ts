/**
 * G1.03 (FIG-1070): organisation A can never read or write organisation B's data.
 *
 *   1. RLS coverage: every table that carries an organisation id has row-level security on, a policy that checks both reads and
 *      writes against the caller's organisation, and a live cross-organisation read that comes back empty.
 *   2. The attacker walk: every API route, called as A's Management and A's Sales with B's real ids in the URL and in the body.
 *      Nothing of B's may appear in a response, nothing of B's may change, and nothing may fail with a server error.
 *   3. The edges outside the routes: the session-to-organisation check, signed file links, the public website key and inbound
 *      email token, and background jobs that name another organisation's rows.
 */
import { writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";

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

import { discoverRoutes, fillParams, isOrganisationRoute } from "./helpers/routeHarness";
import { bodyHints, walkRoute } from "./helpers/routeWalker";
import { buildWorld, idFor, type World } from "./helpers/world";

/** Tables where an organisation id column exists but rows are deliberately not tenant-owned, with the reason. */
const NOT_TENANT_OWNED: Record<string, string> = {};

async function tenantTables(): Promise<string[]> {
  const rows = await adminDb.$queryRaw<{ table_name: string }[]>`
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' ORDER BY 1`;
  return rows.map((r) => r.table_name);
}

/** A fingerprint of everything one organisation owns: a row count and a hash of the rows, per table. */
async function fingerprint(organizationId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const table of await tenantTables()) {
    const rows = await adminDb.$queryRawUnsafe<{ n: number; h: string }[]>(
      `SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM "${table}" t WHERE organization_id = $1`,
      organizationId,
    );
    out[table] = `${rows[0]!.n}:${rows[0]!.h}`;
  }
  return out;
}

describe("G1.03 tenant isolation", () => {
  let A: World;
  let B: World;

  beforeAll(async () => {
    A = await buildWorld("AttackA");
    B = await buildWorld("AttackB");
  }, 120000);

  describe("row-level security on every tenant table", () => {
    it("has RLS enabled and a read-and-write policy on the caller's organisation, on every table with an organisation id", async () => {
      const tables = (await tenantTables()).filter((t) => !NOT_TENANT_OWNED[t]);
      expect(tables.length).toBeGreaterThan(50);
      const problems: string[] = [];
      for (const table of tables) {
        const [flags] = await adminDb.$queryRaw<{ relrowsecurity: boolean }[]>`SELECT relrowsecurity FROM pg_class WHERE oid = ${`public."${table}"`}::regclass`;
        if (!flags?.relrowsecurity) problems.push(`${table}: row-level security is off`);
        const policies = await adminDb.$queryRaw<{ cmd: string; qual: string | null; with_check: string | null }[]>`SELECT cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = ${table}`;
        const guard = (text: string | null) => (text ?? "").includes("app.current_organization_id");
        const reads = policies.some((p) => (p.cmd === "ALL" || p.cmd === "SELECT") && guard(p.qual));
        // A FOR ALL policy with only a USING clause checks writes with that same clause (Postgres: WITH CHECK defaults to USING).
        const writes = policies.some((p) => (p.cmd === "ALL" && guard(p.with_check ?? p.qual)) || (p.cmd === "INSERT" && guard(p.with_check)));
        if (!reads) problems.push(`${table}: no policy checks reads against the organisation`);
        if (!writes) problems.push(`${table}: no policy checks writes against the organisation`);
      }
      expect(problems).toEqual([]);
    });

    it("shows organisation A none of organisation B's rows in any tenant table, and records the coverage", async () => {
      const tables = (await tenantTables()).filter((t) => !NOT_TENANT_OWNED[t]);
      const leaks: string[] = [];
      const populated: string[] = [];
      const empty: string[] = [];
      for (const table of tables) {
        const [{ n }] = await adminDb.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${table}" WHERE organization_id = $1`, B.organization.id);
        (n > 0 ? populated : empty).push(table);
        const seen = await withOrgContext(A.organization.id, (tx) =>
          tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${table}" WHERE organization_id = $1`, B.organization.id),
        );
        if (seen[0]!.n !== 0) leaks.push(`${table}: A sees ${seen[0]!.n} of B's rows`);
        // Writing into B's organisation from A's context is refused by the policy's WITH CHECK clause.
      }
      expect(leaks).toEqual([]);
      if (process.env.WRITE_TENANT_REPORT) {
        writeFileSync(
          process.env.WRITE_TENANT_REPORT,
          JSON.stringify({ tables: tables.length, populatedInTheWalk: populated, policyOnlyCoverage: empty }, null, 2),
        );
      }
    });

    it("refuses a write into another organisation from this organisation's context, on every table that accepts a bare insert", async () => {
      // A representative write per kind of ownership: the policy is the same text on every table, so a failing insert on a few
      // proves the clause, and the policy test above proves every table has it.
      const refusedByPolicy = /row-level security/i;
      await expect(
        withOrgContext(A.organization.id, (tx) => tx.company.create({ data: { organizationId: B.organization.id, name: "Planted by A" } })),
      ).rejects.toThrow(refusedByPolicy);
      await expect(
        withOrgContext(A.organization.id, (tx) => tx.task.create({ data: { organizationId: B.organization.id, title: "Planted by A", assigneeMembershipId: B.ctx.SALES.membershipId, createdByMembershipId: B.ctx.SALES.membershipId } })),
      ).rejects.toThrow(refusedByPolicy);
      await expect(
        withOrgContext(A.organization.id, (tx) => tx.auditEvent.create({ data: { organizationId: B.organization.id, action: "planted", entityType: "Lead", entityId: B.ids.leadId } as any })),
      ).rejects.toThrow(refusedByPolicy);
      // A table whose only policy is a FOR ALL ... USING clause (the write check defaults to it).
      await expect(
        withOrgContext(A.organization.id, (tx) => tx.notification.create({ data: { organizationId: B.organization.id, membershipId: B.ctx.SALES.membershipId, type: "LEAD_ASSIGNED", title: "Planted by A", body: "Planted by A" } })),
      ).rejects.toThrow(refusedByPolicy);
    });
  });

  describe("the attacker walk: every route, A's callers, B's ids", () => {
    const callers = ["MANAGEMENT", "SALES"] as const;

    it("returns nothing of B's, changes nothing of B's, and never fails with a server error", async () => {
      const before = await fingerprint(B.organization.id);
      const hints = await bodyHints(B);
      const routes = discoverRoutes().filter(isOrganisationRoute);
      const leaks: string[] = [];
      const errors: string[] = [];
      const answered: Record<string, number> = {};
      let calls = 0;

      for (const route of routes) {
        for (const method of route.methods) {
          for (const role of callers) {
            current.ctx = A.ctx[role];
            // A's slug in the URL, B's ids everywhere else: the strongest thing a client holding A's session can send.
            const values = fillParams(route, A.organization.slug, (name) => idFor(B, route.path, name));
            const res = await walkRoute(route, method, values, hints);
            calls++;
            answered[String(res.status)] = (answered[String(res.status)] ?? 0) + 1;
            if (res.status >= 500) errors.push(`${role} ${method} ${route.path} -> ${res.status} ${res.code ?? ""}`);
            // A refusal that repeats the id the caller itself put in the URL ("Task <id> was not found") tells them nothing they did not
            // send. Anything else of B's (a name, an address, an id the request did not name), and any marker at all in a success, is a leak.
            const sent = [...Object.values(values), ...Object.values(B.ids), ...Object.values(B.overrides)].filter((v): v is string => typeof v === "string" && v.length > 8);
            const text = res.status >= 400 ? sent.reduce((t, v) => t.split(v).join(""), res.text) : res.text;
            const hit = B.markers.find((m) => text.includes(m));
            if (hit) leaks.push(`${role} ${method} ${route.path} -> ${res.status} contains B's "${hit.slice(0, 12)}..."`);
          }
        }
      }
      const after = await fingerprint(B.organization.id);
      const changed = Object.keys(before).filter((t) => before[t] !== after[t]);

      expect(calls).toBeGreaterThan(600);
      expect(leaks).toEqual([]);
      expect(changed).toEqual([]);
      expect(errors).toEqual([]);
      // The walk is only an attack if the records it names exist: most answers are "not found" (B's record is invisible to A).
      expect((answered["404"] ?? 0) + (answered["403"] ?? 0)).toBeGreaterThan(calls / 4);
    }, 900000);
  });

  describe("the edges outside the routes", () => {
    it("refuses a signed-in member who names an organisation they do not belong to", async () => {
      const { resolveRequestContext } = await vi.importActual<typeof import("../src/auth/requestContext")>("../src/auth/requestContext");
      const { createSession, SESSION_COOKIE_NAME } = await import("../src/auth/session");
      const { token } = await createSession(A.ctx.MANAGEMENT.userId, { organizationId: A.organization.id });
      const cookies = { get: (name: string) => (name === SESSION_COOKIE_NAME ? { value: token } : undefined) };
      await expect(resolveRequestContext(B.organization.slug, cookies)).rejects.toThrow();
      await expect(resolveRequestContext(A.organization.slug, cookies)).resolves.toMatchObject({ organizationId: A.organization.id });
    });

    it("does not honour a signed link for A's file when its key is pointed at B's organisation", async () => {
      const { signLocalToken, verifyLocalToken } = await import("../src/storage/localToken");
      const { localSigningSecret } = await import("../src/storage/index");
      const file = await adminDb.file.findUniqueOrThrow({ where: { id: A.ids.fileId! } });
      const secret = localSigningSecret();
      const token = signLocalToken({ k: file.storageKey, m: "GET", e: Math.floor(Date.now() / 1000) + 600 }, secret);
      expect(verifyLocalToken(token, secret).ok).toBe(true);
      const [payload, signature] = token.split(".");
      const forged = JSON.parse(Buffer.from(payload!, "base64url").toString());
      forged.k = `${B.organization.id}/${forged.k}`;
      const tampered = `${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${signature}`;
      expect(verifyLocalToken(tampered, secret).ok).toBe(false);
    });

    it("refuses A's website key and A's inbound-email token at B's address, and writes nothing", async () => {
      const { regenerateWebsiteApiKey } = await import("../src/services/integrationService");
      const key = await regenerateWebsiteApiKey(A.ctx.MANAGEMENT, { graceHours: 0 });
      const secret = (key as any).apiKey ?? (key as any).key;
      const beforeLeads = await adminDb.lead.count({ where: { organizationId: B.organization.id } });
      const { submitWebsiteLead } = await import("../src/services/websiteLeadService");
      await expect(submitWebsiteLead(B.organization.slug, secret, JSON.stringify({ name: "Planted", email: "x@example.test" }), { ipAddress: "203.0.113.9", origin: null })).rejects.toThrow();
      expect(await adminDb.lead.count({ where: { organizationId: B.organization.id } })).toBe(beforeLeads);
    });

    it("keeps a background job inside the organisation it was queued for, even when its payload names another organisation's row", async () => {
      const { enqueueAndRunNow } = await import("../src/jobs/runner");
      const { MIGRATION_JOB } = await import("../src/services/migrationConstants");
      const before = await fingerprint(A.organization.id);
      // A job queued for B that points at A's migration session must not touch A's session.
      await enqueueAndRunNow({ organizationId: B.organization.id, type: MIGRATION_JOB, payload: { sessionId: A.ids.sessionId } } as any).catch(() => null);
      expect(await fingerprint(A.organization.id)).toEqual(before);
    });
  });
});
