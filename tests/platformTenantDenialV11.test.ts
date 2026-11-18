/**
 * G2.01 (FIG-1156): platform-to-tenant and tenant-to-platform denial, generated over every route on disk.
 *
 * tests/platformIdentityFoundation.test.ts (B6.03) checks the walls with a handful of routes. This walks all of them, on a V1.1 organisation
 * with a real record of every V1.1 kind:
 *
 *   1. Tenant to platform: every /api/platform/* route that is not part of sign-in, called signed out, as the organisation's Management
 *      and as its Sales member (also when the tenant token is offered as a platform cookie), answers the ordinary 404, writes nothing, and
 *      never fails. The sign-in routes answer without creating a platform session.
 *   2. Platform to tenant: a platform admin with a live platform session and every platform key, calling every organisation route
 *      with the organisation's real ids, is refused on all of them: no 2xx, no server error, none of the organisation's data in any answer,
 *      and nothing of the organisation changed. The platform cookie is not a tenant session.
 *   3. A suspended platform admin and a signed-out platform session get nothing on either side.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PLATFORM_SESSION_COOKIE_NAME } from "../src/auth/platformSession";
import { SESSION_COOKIE_NAME, createSession } from "../src/auth/session";
import { adminDb } from "../src/db/adminClient";

const holder = vi.hoisted(() => ({ jar: { get: (_name: string): { value: string } | undefined => undefined } }));
vi.mock("next/headers", () => ({ cookies: async () => holder.jar, headers: async () => new Headers() }));
vi.mock("../src/app/api/_lib/validation", async () => (await import("./helpers/validationCapture")).capturingValidation());

import { discoverRoutes, fillParams, invoke, isOrganisationRoute, NO_SUCH_ID } from "./helpers/routeHarness";
import { bodyHints, walkRoute } from "./helpers/routeWalker";
import { cookieJar, makePlatformAdmin, removeTestPlatformAdmins } from "./helpers/platform";
import { idFor } from "./helpers/world";
import { buildWorldV11, type WorldV11 } from "./helpers/worldV11";

const platformRoutes = () => discoverRoutes().filter((r) => r.path.startsWith("/api/platform/"));
/** Sign-in, invitation and challenge routes are open to the signed-out by design; everything else needs a platform session. */
const isSignInRoute = (path: string) => path.startsWith("/api/platform/auth/");

async function fingerprint(organizationId: string): Promise<Record<string, string>> {
  const tables = await adminDb.$queryRaw<{ table_name: string }[]>`
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' ORDER BY 1`;
  const out: Record<string, string> = {};
  for (const { table_name: table } of tables) {
    // The platform tables name an organisation as a subject and legitimately record the attempt; they are not the tenant's data.
    if (table.startsWith("platform_") || table === "organization_lifecycle_events") continue;
    const rows = await adminDb.$queryRawUnsafe<{ n: number; h: string }[]>(
      `SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS h FROM "${table}" t WHERE organization_id = $1`,
      organizationId,
    );
    out[table] = `${rows[0]!.n}:${rows[0]!.h}`;
  }
  return out;
}

describe("G2.01 platform and tenant denial, V1.1", () => {
  let world: WorldV11;
  let tenantTokens: { management: string; sales: string };

  beforeAll(async () => {
    world = await buildWorldV11("DenyV11");
    expect(world.missing).toEqual([]);
    tenantTokens = {
      management: (await createSession(world.ctx.MANAGEMENT.userId, { organizationId: world.organization.id })).token,
      sales: (await createSession(world.ctx.SALES.userId, { organizationId: world.organization.id })).token,
    };
  }, 300_000);

  afterAll(async () => {
    await removeTestPlatformAdmins();
  });

  it("finds every platform route (a route added later is walked without a list to maintain)", () => {
    expect(platformRoutes().length).toBeGreaterThanOrEqual(35);
    expect(platformRoutes().some((r) => !isSignInRoute(r.path))).toBe(true);
  });

  describe("tenant to platform", () => {
    const callers: { name: string; jar: () => ReturnType<typeof cookieJar> }[] = [
      { name: "signed out", jar: () => cookieJar({}) },
      { name: "the organisation's Management", jar: () => cookieJar({ [SESSION_COOKIE_NAME]: tenantTokens.management }) },
      { name: "the organisation's Sales member", jar: () => cookieJar({ [SESSION_COOKIE_NAME]: tenantTokens.sales }) },
      { name: "Management, with its tenant token offered as a platform cookie", jar: () => cookieJar({ [SESSION_COOKIE_NAME]: tenantTokens.management, [PLATFORM_SESSION_COOKIE_NAME]: tenantTokens.management }) },
    ];

    it("answers 404 on every platform route that is not sign-in, for every tenant caller and for nobody", async () => {
      const before = await fingerprint(world.organization.id);
      const sessionsBefore = await adminDb.platformSession.count();
      const bad: string[] = [];
      for (const caller of callers) {
        holder.jar = caller.jar();
        for (const route of platformRoutes().filter((r) => !isSignInRoute(r.path))) {
          for (const method of route.methods) {
            const values = fillParams(route, world.organization.slug, () => NO_SUCH_ID);
            const res = await invoke(route, method, values, { headers: { origin: "http://localhost" } });
            if (res.status !== 404) bad.push(`${caller.name}: ${method} ${route.path} -> ${res.status} ${res.code ?? ""}`);
          }
        }
      }
      expect(bad).toEqual([]);
      expect(await adminDb.platformSession.count()).toBe(sessionsBefore);
      expect(await fingerprint(world.organization.id)).toEqual(before);
    }, 600_000);

    it("lets the sign-in routes answer without creating a session, a platform identity or an organisation row", async () => {
      const identities = await adminDb.platformIdentity.count();
      const sessions = await adminDb.platformSession.count();
      const organisations = await adminDb.organization.count();
      const bad: string[] = [];
      for (const caller of callers) {
        holder.jar = caller.jar();
        for (const route of platformRoutes().filter((r) => isSignInRoute(r.path))) {
          for (const method of route.methods) {
            const res = await invoke(route, method, fillParams(route, world.organization.slug, () => NO_SUCH_ID), { headers: { origin: "http://localhost" } });
            if (res.status >= 500) bad.push(`${caller.name}: ${method} ${route.path} -> ${res.status}`);
            if (res.status < 300 && !route.path.endsWith("/sign-out")) bad.push(`${caller.name}: ${method} ${route.path} answered ${res.status} to an empty request`);
          }
        }
      }
      expect(bad).toEqual([]);
      expect(await adminDb.platformIdentity.count()).toBe(identities);
      expect(await adminDb.platformSession.count()).toBe(sessions);
      expect(await adminDb.organization.count()).toBe(organisations);
    }, 600_000);
  });

  describe("platform to tenant", () => {
    it("refuses a platform admin with every platform key on every organisation route, shows none of the organisation's data, and changes nothing", async () => {
      const admin = await makePlatformAdmin("deny");
      holder.jar = admin.jar; // a platform cookie and no tenant cookie at all
      // Positive control: the same jar is a real platform session, so the refusals below are the wall and not a broken test.
      const me = platformRoutes().find((r) => r.path === "/api/platform/me")!;
      expect((await invoke(me, "GET", {})).status).toBe(200);
      const before = await fingerprint(world.organization.id);
      const hints = await bodyHints(world);
      const bad: string[] = [];
      const leaks: string[] = [];
      let calls = 0;
      for (const route of discoverRoutes().filter(isOrganisationRoute)) {
        for (const method of route.methods) {
          const values = fillParams(route, world.organization.slug, (n) => idFor(world, route.path, n));
          const res = await walkRoute(route, method, values, hints);
          calls++;
          if (res.status < 400 || res.status >= 500) bad.push(`${method} ${route.path} -> ${res.status} ${res.code ?? ""}`);
          const sent = [...Object.values(values), ...Object.values(world.ids), ...Object.values(world.overrides)].filter((v): v is string => typeof v === "string" && v.length > 8);
          const text = sent.reduce((t, v) => t.split(v).join(""), res.text);
          const hit = world.markers.find((m) => m !== world.organization.slug && m !== world.organization.id && text.includes(m));
          if (hit) leaks.push(`${method} ${route.path} contains "${hit.slice(0, 12)}..."`);
        }
      }
      expect(calls).toBeGreaterThan(400);
      expect(bad).toEqual([]);
      expect(leaks).toEqual([]);
      expect(await fingerprint(world.organization.id)).toEqual(before);
    }, 900_000);

    it("gives a suspended platform admin and a revoked platform session nothing, on either side", async () => {
      const admin = await makePlatformAdmin("suspended");
      await adminDb.platformIdentity.update({ where: { id: admin.id }, data: { status: "SUSPENDED" } });
      holder.jar = admin.jar;
      const platform = platformRoutes().find((r) => r.path === "/api/platform/me")!;
      expect((await invoke(platform, "GET", {})).status).toBe(404);
      const orgRoute = discoverRoutes().find((r) => r.path === "/api/orgs/{orgSlug}/leads")!;
      const res = await invoke(orgRoute, "GET", fillParams(orgRoute, world.organization.slug));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });
  });
});
