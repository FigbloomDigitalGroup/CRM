/**
 * FIG-1188 (B7.06): the authorization matrix extended to live roles. The generated matrix of G1.02 and G2.01 covers the five platform
 * roles from a reviewed file. Custom roles are data, so this matrix is built at run time from the roles the database holds: every
 * platform role and several custom roles are listed through the editor, each gets a member, and a set of real route handlers is called
 * as each member. What each role may do is derived independently from the permission keys it carries (the `needsAny` lists below),
 * and the answer of the route must agree: 403 exactly when none of the needed keys is held. On top of that, the invariants of the
 * editor hold for every live role (no reserved key on a custom role, payments only for Finance and Management, no value or payment
 * in an answer for a role that may not see it), and the editor's own routes are walked end to end.
 */
import { describe, expect, it, vi } from "vitest";
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

import { resolveActiveMembership } from "../src/repositories/memberships";
import * as companyService from "../src/services/companyService";
import * as dealService from "../src/services/dealService";
import { setOrganizationRelease } from "../src/services/featureService";
import { createRole, listRoles, type RoleView } from "../src/services/roleEditorService";
import { ADMIN_RESERVED_KEYS, SENSITIVE_RESERVED_KEYS } from "../src/lib/roleLimits";
import { discoverRoutes, invoke, NO_SUCH_ID, type DiscoveredRoute } from "./helpers/routeHarness";
import { createTestContext, createTestMembership, createTestOrganization, getPipelineStageId } from "./helpers/fixtures";

const route = (path: string): DiscoveredRoute => {
  const r = discoverRoutes().find((x) => x.path === `/api/orgs/{orgSlug}${path}`);
  if (!r) throw new Error(`No route ${path}`);
  return r;
};

const SENTINEL_VALUE = 7_654_321;

async function memberFor(organizationId: string, role: RoleView): Promise<AuthContext> {
  const { membership, user } = await createTestMembership(organizationId, "SALES", `live.${role.key.toLowerCase().slice(0, 12)}`);
  await adminDb.membership.update({ where: { id: membership.id }, data: { roleId: role.id } });
  const ctx = await resolveActiveMembership(user.id, organizationId);
  if (!ctx) throw new Error(`no membership for ${role.key}`);
  return ctx;
}

/** What each probe needs: allowed exactly when the role carries at least one of these keys (an independent statement of the rules). */
const PROBES: Array<{ name: string; path: string; method: "GET" | "POST"; body?: object; query?: string; needsAny: string[] }> = [
  { name: "list roles", path: "/roles", method: "GET", needsAny: ["roles.manage", "role.assign"] },
  { name: "roles catalogue", path: "/roles/catalog", method: "GET", needsAny: ["roles.manage"] },
  { name: "role preview", path: "/roles/preview", method: "POST", body: { permissionKeys: ["contacts.view"] }, needsAny: ["roles.manage"] },
  { name: "list leads", path: "/leads", method: "GET", needsAny: ["leads.view.own", "leads.view.all", "leads.view.shared"] },
  { name: "list deals", path: "/deals", method: "GET", needsAny: ["deals.view.own", "deals.view.all", "deals.view.won"] },
  { name: "audit log", path: "/audit", method: "GET", query: "?entityType=Deal&entityId=00000000-0000-4000-8000-000000000000", needsAny: ["audit.view"] },
  { name: "list invoices", path: "/invoices", method: "GET", needsAny: ["finance.view.payments"] },
];

describe("authorization matrix generated from live roles (V2 organisation)", () => {
  it("answers every probe as the role's own keys say, for platform and custom roles alike", async () => {
    const org = await createTestOrganization("LiveMatrix");
    await setOrganizationRelease(org.id, "v2");
    const management = await createTestContext(org.id, "MANAGEMENT", "live.mgmt");

    await createRole(management, { name: "Read Only Sales", permissionKeys: ["leads.view.all", "deals.view.all", "companies.view", "contacts.view"] });
    await createRole(management, { name: "Value Viewer", basedOnRoleKey: "SALES", fieldRules: { "deal.value": "all" } });
    await createRole(management, { name: "Locked Down", basedOnRoleKey: "SALES", fieldRules: { "deal.value": "hidden" } });
    await createRole(management, { name: "Empty", permissionKeys: [] });

    const { roles } = await listRoles(management);
    expect(roles.filter((r) => r.kind === "platform")).toHaveLength(5);
    expect(roles.filter((r) => r.kind === "custom")).toHaveLength(4);

    // One deal with a sentinel value, owned by the Management member, that no role without value rights may ever see.
    const { company } = await companyService.createCompany(management, { name: "Matrix Co" });
    await dealService.createDeal(management, { companyId: company.id, pipelineStageId: await getPipelineStageId(org.id), value: SENTINEL_VALUE, currency: "KES" });

    const rows: string[] = [];
    for (const role of roles) {
      const ctx = await memberFor(org.id, role);
      const keys = new Set(ctx.permissionKeys);

      // Invariants of the editor, for every live role.
      if (role.kind === "custom") {
        for (const k of [...ADMIN_RESERVED_KEYS, ...SENSITIVE_RESERVED_KEYS]) expect(keys.has(k), `${role.name} carries ${k}`).toBe(false);
      }
      if (keys.has("finance.view.payments")) expect(["FINANCE", "MANAGEMENT"], `${role.name} sees payments`).toContain(role.key);
      if (keys.has("roles.manage")) expect(role.key).toBe("MANAGEMENT");

      current.ctx = ctx;
      const letters: string[] = [];
      for (const probe of PROBES) {
        const result = await invoke(route(probe.path), probe.method, { orgSlug: "x" }, { body: probe.body, query: probe.query });
        const allowed = probe.needsAny.some((k) => keys.has(k));
        expect(result.status, `${role.name} / ${probe.name}: ${result.text.slice(0, 200)}`).toBeLessThan(500);
        if (allowed) expect(result.status, `${role.name} / ${probe.name} should be reached`).not.toBe(403);
        else expect(result.status, `${role.name} / ${probe.name} should be refused`).toBe(403);
        letters.push(result.status === 403 ? "D" : "A");

        // No answer for a role without value rights may hold the sentinel; a refusal must explain itself.
        if (!keys.has("deals.view.value")) expect(result.text.replace(/[,\s]/g, "")).not.toContain(String(SENTINEL_VALUE));
        if (result.status === 403) expect(result.json?.denial, `${role.name} / ${probe.name} denial`).toBeTruthy();
      }
      rows.push(`${role.kind === "custom" ? "custom  " : "platform"} ${role.name.padEnd(24)} ${letters.join("")}`);
    }
    // The matrix is printed so a reviewer can read it; the assertions above are the test.
    console.info(`Live role matrix (${PROBES.map((p) => p.name).join(" | ")}):\n${rows.join("\n")}`);
    current.ctx = null;
  }, 120_000);
});

describe("the editor's routes, end to end", () => {
  it("creates, previews, edits, assigns and archives through the handlers, and refuses everything it should", async () => {
    const org = await createTestOrganization("RoleRoutes");
    await setOrganizationRelease(org.id, "v2");
    const management = await createTestContext(org.id, "MANAGEMENT", "rr.mgmt");
    const sales = await createTestContext(org.id, "SALES", "rr.sales");
    const roles = route("/roles");
    const one = route("/roles/{roleId}");
    const values = { orgSlug: "x" };

    // Signed out.
    current.ctx = null;
    expect((await invoke(roles, "GET", values)).status).toBe(401);

    // A role that may not manage roles is refused with an explained denial.
    current.ctx = sales;
    const refused = await invoke(roles, "POST", values, { body: { name: "Nope", permissionKeys: [] } });
    expect(refused.status).toBe(403);
    expect(refused.json.denial).toBeTruthy();

    current.ctx = management;
    // Validation: unknown body keys, reserved keys.
    expect((await invoke(roles, "POST", values, { body: { name: "Bad", surprise: 1 } })).status).toBe(400);
    const reserved = await invoke(roles, "POST", values, { body: { name: "Bad", permissionKeys: ["finance.view.payments"] } });
    expect(reserved.status).toBe(400);
    expect(reserved.json.fieldErrors?.length ?? reserved.json.issues?.length).toBeGreaterThan(0);

    // Create, read, preview, edit.
    const created = await invoke(roles, "POST", values, { body: { name: "Route Role", permissionKeys: ["contacts.view"] }, headers: { "idempotency-key": "role-route-create-1" } });
    expect(created.status).toBe(200);
    const id = created.json.id as string;
    expect((await invoke(one, "GET", { ...values, roleId: id })).json.name).toBe("Route Role");
    const preview = await invoke(route("/roles/preview"), "POST", values, { body: { roleId: id, permissionKeys: ["contacts.view", "companies.view"] } });
    expect(preview.json.gained).toEqual(["companies.view"]);
    const patched = await invoke(one, "PATCH", { ...values, roleId: id }, { body: { permissionKeys: ["contacts.view", "companies.view"], description: "Reads people and companies." } });
    expect(patched.json.permissionKeys).toEqual(["companies.view", "contacts.view"]);

    // A platform role cannot be edited; an unknown or foreign id is not found.
    const platform = (await invoke(roles, "GET", values)).json.roles.find((r: RoleView) => r.key === "SALES") as RoleView;
    expect((await invoke(one, "PATCH", { ...values, roleId: platform.id }, { body: { name: "Renamed" } })).status).toBe(400);
    expect((await invoke(one, "GET", { ...values, roleId: NO_SUCH_ID })).status).toBe(404);
    const otherOrg = await createTestOrganization("RoleRoutesOther");
    await setOrganizationRelease(otherOrg.id, "v2");
    current.ctx = await createTestContext(otherOrg.id, "MANAGEMENT", "rr.other");
    expect((await invoke(one, "GET", { ...values, roleId: id })).status).toBe(404);
    expect((await invoke(one, "DELETE", { ...values, roleId: id })).status).toBe(404);
    expect((await invoke(roles, "GET", values)).json.roles.some((r: RoleView) => r.id === id)).toBe(false);

    // Archive.
    current.ctx = management;
    expect((await invoke(one, "DELETE", { ...values, roleId: id })).json).toEqual({ archived: true });
    current.ctx = null;
  }, 120_000);

  it("answers an organisation below V2 with the explained 'not available yet', before anything else", async () => {
    const org = await createTestOrganization("RoleRoutesV1");
    const management = await createTestContext(org.id, "MANAGEMENT", "v1.mgmt");
    current.ctx = management;
    for (const [path, method] of [["/roles", "GET"], ["/roles/catalog", "GET"], ["/roles", "POST"], ["/roles/preview", "POST"]] as const) {
      const r = await invoke(route(path), method, { orgSlug: "x" }, method === "POST" ? { body: {} } : {});
      expect(r.status, path).toBe(403);
      expect(r.code, path).toBe("FEATURE_UNAVAILABLE");
    }
    current.ctx = null;
  });
});
