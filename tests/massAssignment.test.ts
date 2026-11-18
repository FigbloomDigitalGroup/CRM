import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { adminDb } from "../src/db/adminClient";

const current: { ctx: AuthContext | null } = { ctx: null };
vi.mock("../src/auth/requestContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth/requestContext")>();
  return { ...actual, resolveRequestContext: async () => current.ctx };
});

import { discoverRoutes, invoke, type DiscoveredRoute } from "./helpers/routeHarness";
import { buildWorld, type World } from "./helpers/world";

/**
 * G1.05: mass assignment. A client can send any JSON it likes; only the fields a route's schema names may ever reach the database, and
 * the fields that decide who owns a record, which organisation it is in and what it is worth to the business cannot be set from outside.
 */
describe("mass assignment (G1.05)", () => {
  let A: World;
  let B: World;
  let route: DiscoveredRoute;

  beforeAll(async () => {
    A = await buildWorld("MassA");
    B = await buildWorld("MassB");
    route = discoverRoutes().find((r) => r.path === "/api/orgs/{orgSlug}/leads" && r.methods.includes("POST"))!;
  }, 120000);

  it("reads a request body only through a route schema, with the one public webhook as the exception (which validates it itself)", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name === "route.ts" && /request\.json\(\)/.test(readFileSync(p, "utf8"))) offenders.push(p.split("\\").join("/"));
      }
    };
    walk("src/app");
    expect(offenders).toEqual(["src/app/api/public/orgs/[orgSlug]/communications/inbound/route.ts"]);
  });

  it("ignores fields that name another organisation, another creator, a chosen id, a forged score or a conversion date", async () => {
    current.ctx = A.ctx.SALES;
    const status = await adminDb.leadStatus.findFirstOrThrow({ where: { organizationId: A.organization.id, key: "NEW" } });
    const chosenId = "11111111-2222-4333-8444-555555555555";
    const res = await invoke(route, "POST", { orgSlug: A.organization.slug }, {
      body: {
        leadStatusId: status.id,
        notes: "should not even be a field",
        organizationId: B.organization.id,
        createdByMembershipId: A.ctx.MANAGEMENT.membershipId,
        id: chosenId,
        scoreValue: 99,
        scoreBand: "HOT",
        convertedAt: "2020-01-01T00:00:00.000Z",
        archivedAt: "2020-01-01T00:00:00.000Z",
      },
    });
    expect(res.status, res.text).toBeLessThan(300);
    const saved = await adminDb.lead.findUniqueOrThrow({ where: { id: res.json.lead.id } });
    expect(saved.organizationId).toBe(A.organization.id);
    expect(saved.createdByMembershipId).toBe(A.ctx.SALES.membershipId);
    expect(saved.ownerMembershipId).toBe(A.ctx.SALES.membershipId);
    expect(saved.id).not.toBe(chosenId);
    expect(saved.scoreValue).not.toBe(99);
    expect(saved.convertedAt).toBeNull();
    expect(saved.archivedAt).toBeNull();
    expect(await adminDb.lead.count({ where: { id: chosenId } })).toBe(0);
    expect(await adminDb.lead.count({ where: { organizationId: B.organization.id, createdByMembershipId: A.ctx.MANAGEMENT.membershipId } })).toBe(0);
  });

  it("does not let a caller without the assign permission hand a new lead to somebody else", async () => {
    current.ctx = A.ctx.SALES;
    const status = await adminDb.leadStatus.findFirstOrThrow({ where: { organizationId: A.organization.id, key: "NEW" } });
    const before = await adminDb.lead.count({ where: { organizationId: A.organization.id } });
    const res = await invoke(route, "POST", { orgSlug: A.organization.slug }, {
      body: { leadStatusId: status.id, ownerMembershipId: A.ctx.MANAGEMENT.membershipId },
    });
    expect(res.status).toBe(403);
    expect(await adminDb.lead.count({ where: { organizationId: A.organization.id } })).toBe(before);
  });

  it("answers a status, source, company or contact from another organisation with a validation error naming the field (never a server error)", async () => {
    current.ctx = A.ctx.MANAGEMENT;
    const foreignStatus = await adminDb.leadStatus.findFirstOrThrow({ where: { organizationId: B.organization.id, key: "NEW" } });
    const res = await invoke(route, "POST", { orgSlug: A.organization.slug }, {
      body: { leadStatusId: foreignStatus.id, companyId: B.ids.companyId, contactId: B.ids.contactId },
    });
    expect(res.status, res.text).toBe(400);
    expect(res.code).toBe("VALIDATION_FAILED");
    const paths = (res.json.fieldErrors as { path: string }[]).map((f) => f.path).sort();
    expect(paths).toEqual(["companyId", "contactId", "leadStatusId"]);
  });
});
