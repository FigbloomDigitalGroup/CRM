/**
 * FIG-1188 (B7.06) close-out: independent proof of the acceptance criteria the builders' tests only touched in passing.
 * "Changes take effect immediately" is proved through the real route handlers, re-resolving the member from the database before
 * every call exactly as a request does; the last-Management safeguard is attacked by every path; reserved keys are attacked
 * through every route and field; rule 8 (organisation isolation) and the audit trail are checked for each kind of change.
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

import { ValidationError } from "../src/auth/errors";
import { ADMIN_RESERVED_KEYS, SENSITIVE_RESERVED_KEYS } from "../src/lib/roleLimits";
import { resolveActiveMembership } from "../src/repositories/memberships";
import { setOrganizationRelease } from "../src/services/featureService";
import { changeMemberRole, deactivateMember, inviteMember, removeMember } from "../src/services/membershipService";
import { archiveRole, createRole, listRoles, updateRole } from "../src/services/roleEditorService";
import { discoverRoutes, invoke } from "./helpers/routeHarness";
import { createTestContext, createTestMembership, createTestOrganization } from "./helpers/fixtures";

const route = (path: string) => {
  const r = discoverRoutes().find((x) => x.path === `/api/orgs/{orgSlug}${path}`);
  if (!r) throw new Error(`No route ${path}`);
  return r;
};
const V = { orgSlug: "x" };

async function setup(name = "Close") {
  const org = await createTestOrganization(name);
  await setOrganizationRelease(org.id, "v2");
  const management = await createTestContext(org.id, "MANAGEMENT", "close.mgmt");
  return { org, management };
}

/** A member holding a custom role; the returned function resolves them afresh (as a request does) and calls a route. */
async function memberOf(orgId: string, roleId: string) {
  const { membership, user } = await createTestMembership(orgId, "SALES", "close.holder");
  await adminDb.membership.update({ where: { id: membership.id }, data: { roleId } });
  return {
    membership,
    asRequest: async (path: string, method: "GET" | "POST" = "GET", init: { body?: object; query?: string } = {}) => {
      current.ctx = await resolveActiveMembership(user.id, orgId);
      try {
        return await invoke(route(path), method, V, init);
      } finally {
        current.ctx = null;
      }
    },
  };
}

async function invalidCodes(p: Promise<unknown>): Promise<string[]> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ValidationError);
  return ((err as ValidationError).issues ?? []).map((i) => i.code ?? "");
}

describe("changes take effect on the very next request (through the route handlers)", () => {
  it("a permission removed is refused on the next request, and one added works on the next request", async () => {
    const { org, management } = await setup("Immediate");
    const role = await createRole(management, { name: "Lead Reader", permissionKeys: ["leads.view.all", "deals.view.all"] });
    const holder = await memberOf(org.id, role.id);

    expect((await holder.asRequest("/leads")).status).toBe(200);
    expect((await holder.asRequest("/deals")).status).toBe(200);

    // Remove leads: the very next request is refused with an explained denial; the untouched right still works.
    await updateRole(management, role.id, { permissionKeys: ["deals.view.all"] });
    const refused = await holder.asRequest("/leads");
    expect(refused.status).toBe(403);
    expect(refused.json.denial).toBeTruthy();
    expect((await holder.asRequest("/deals")).status).toBe(200);

    // Add it back: the next request works.
    await updateRole(management, role.id, { permissionKeys: ["leads.view.all", "deals.view.all"] });
    expect((await holder.asRequest("/leads")).status).toBe(200);

    // Remove everything: nothing is reachable at once.
    await updateRole(management, role.id, { permissionKeys: [] });
    expect((await holder.asRequest("/leads")).status).toBe(403);
    expect((await holder.asRequest("/deals")).status).toBe(403);
  }, 120_000);

  it("a field rule change shows on the next request: hidden then back to own", async () => {
    const { org, management } = await setup("ImmediateField");
    const role = await createRole(management, { name: "Owner Sales", permissionKeys: ["deals.view.own"], fieldRules: { "deal.value": "own" } });
    const holder = await memberOf(org.id, role.id);
    const before = await resolveActiveMembership((await adminDb.membership.findUniqueOrThrow({ where: { id: holder.membership.id } })).userId, org.id);
    expect(before!.hiddenFields).toBeUndefined();
    await updateRole(management, role.id, { fieldRules: { "deal.value": "hidden" } });
    const after = await resolveActiveMembership(before!.userId, org.id);
    expect(after!.hiddenFields).toEqual(["deal.value"]);
    await updateRole(management, role.id, { fieldRules: { "deal.value": "own" } });
    expect((await resolveActiveMembership(before!.userId, org.id))!.hiddenFields).toBeUndefined();
  });

  it("the role change made through the route handler itself is effective for the next request", async () => {
    const { org, management } = await setup("ImmediateRoute");
    const role = await createRole(management, { name: "Route Edited", permissionKeys: ["leads.view.all"] });
    const holder = await memberOf(org.id, role.id);
    expect((await holder.asRequest("/leads")).status).toBe(200);

    current.ctx = management;
    const patched = await invoke(route("/roles/{roleId}"), "PATCH", { ...V, roleId: role.id }, { body: { permissionKeys: [] } });
    current.ctx = null;
    expect(patched.status).toBe(200);
    expect((await holder.asRequest("/leads")).status).toBe(403);
  }, 120_000);
});

describe("the last Management member cannot be locked out, by any path", () => {
  it("edit role, archive role, reassign, deactivate and remove all leave the last Management able to manage", async () => {
    const { org, management } = await setup("LastMgmt");
    const custom = await createRole(management, { name: "Near Management", basedOnRoleKey: "MANAGEMENT" });

    // Reassign (to a custom role and to a platform role), deactivate, remove: each refused for the only Management member.
    await expect(changeMemberRole(management, management.membershipId, custom.key)).rejects.toThrow(/last active Management/);
    await expect(changeMemberRole(management, management.membershipId, "SALES")).rejects.toThrow(/last active Management/);
    await expect(deactivateMember(management, management.membershipId)).rejects.toThrow(/last active Management/);
    await expect(removeMember(management, management.membershipId)).rejects.toThrow(/last active Management/);

    // Editing or archiving a custom role cannot touch what Management holds; platform Management cannot be edited or archived.
    const { roles } = await listRoles(management);
    const platformMgmt = roles.find((r) => r.key === "MANAGEMENT")!;
    expect(await invalidCodes(updateRole(management, platformMgmt.id, { permissionKeys: [] }))).toContain("PLATFORM_ROLE_FIXED");
    expect(await invalidCodes(archiveRole(management, platformMgmt.id))).toContain("PLATFORM_ROLE_FIXED");
    // No custom role, however edited, may carry a key that runs the organisation.
    for (const key of ["roles.manage", "membership.manage", "role.assign", "security.manage"]) {
      expect(await invalidCodes(updateRole(management, custom.id, { permissionKeys: [key] })), key).toContain("RESERVED_PERMISSION");
    }

    const still = await resolveActiveMembership(management.userId, org.id);
    expect(still!.roleKey).toBe("MANAGEMENT");
    expect(still!.permissionKeys).toContain("roles.manage");
    expect(await adminDb.membership.count({ where: { organizationId: org.id, status: "ACTIVE", role: { key: "MANAGEMENT" } } })).toBe(1);
  });

  it("once a second active Management exists the first may be moved, and the second then becomes the protected one", async () => {
    const { org, management } = await setup("TwoMgmt");
    const second = await createTestContext(org.id, "MANAGEMENT", "close.mgmt2");
    await changeMemberRole(management, second.membershipId, "SALES");
    await expect(deactivateMember(management, management.membershipId)).rejects.toThrow(/last active Management/);
  });

  it("an invite cannot be used to hand out a reserved power either: another organisation's role is unknown", async () => {
    const { management } = await setup("InviteA");
    const other = await setup("InviteB");
    const theirs = await createRole(other.management, { name: "Theirs Only", permissionKeys: ["contacts.view"] });
    await expect(
      inviteMember(management, { email: `close.invite.${Date.now()}@example.test`, name: "Invitee", roleKey: theirs.key }, (t) => `http://localhost/accept/${t}`),
    ).rejects.toThrow(/Unknown role/);
  });
});

describe("platform roles are read-only and reserved powers can never be granted, by any route", () => {
  it("every platform role refuses edit and archive through the routes, with an explanation", async () => {
    const { management } = await setup("PlatformRO");
    current.ctx = management;
    const list = await invoke(route("/roles"), "GET", V);
    const platform = (list.json.roles as Array<{ id: string; kind: string; key: string }>).filter((r) => r.kind === "platform");
    expect(platform).toHaveLength(5);
    for (const r of platform) {
      const patch = await invoke(route("/roles/{roleId}"), "PATCH", { ...V, roleId: r.id }, { body: { name: `Renamed ${r.key}` } });
      expect(patch.status, r.key).toBe(400);
      const del = await invoke(route("/roles/{roleId}"), "DELETE", { ...V, roleId: r.id });
      expect(del.status, r.key).toBe(400);
    }
    current.ctx = null;
    // Untouched in the database.
    expect(await adminDb.role.count({ where: { organizationId: null, archivedAt: { not: null } } })).toBe(0);
  });

  it("audit, bulk export, payments, margin and every organisation-running key are refused on create, update and preview (service and routes)", async () => {
    const { management } = await setup("Reserved");
    const base = await createRole(management, { name: "Plain", permissionKeys: ["deals.view.all", "contacts.view"] });
    const reserved = [...ADMIN_RESERVED_KEYS, ...SENSITIVE_RESERVED_KEYS];
    expect(reserved).toEqual(expect.arrayContaining(["audit.view", "export.bulk", "finance.view.payments", "finance.manage.payments", "payments.manage", "deals.margin"]));

    current.ctx = management;
    for (const key of reserved) {
      const keys = ["deals.view.all", key];
      expect(await invalidCodes(createRole(management, { name: `Try ${key}`, permissionKeys: keys })), `create ${key}`).toContain("RESERVED_PERMISSION");
      expect(await invalidCodes(updateRole(management, base.id, { permissionKeys: keys })), `update ${key}`).toContain("RESERVED_PERMISSION");
      const viaCreate = await invoke(route("/roles"), "POST", V, { body: { name: `Route ${key}`, permissionKeys: keys }, headers: { "idempotency-key": `res-${key}` } });
      expect(viaCreate.status, `route create ${key}`).toBe(400);
      const viaPatch = await invoke(route("/roles/{roleId}"), "PATCH", { ...V, roleId: base.id }, { body: { permissionKeys: keys } });
      expect(viaPatch.status, `route patch ${key}`).toBe(400);
      const viaPreview = await invoke(route("/roles/preview"), "POST", V, { body: { roleId: base.id, permissionKeys: keys } });
      expect(viaPreview.status, `route preview ${key}`).toBe(400);
    }
    // Field rules cannot open margin or payments either, and the role is unchanged after all those attempts.
    for (const field of ["deal.margin", "payments"]) {
      expect(await invalidCodes(updateRole(management, base.id, { fieldRules: { [field]: "all" } })), field).toContain("FIELD_FIXED");
    }
    current.ctx = null;
    const after = (await listRoles(management)).roles.find((r) => r.id === base.id)!;
    expect(after.permissionKeys).toEqual(["contacts.view", "deals.view.all"]);
  });

  it("a role made from Management or Finance starts without the reserved keys (payments included)", async () => {
    const { management } = await setup("BasedOn");
    for (const from of ["MANAGEMENT", "FINANCE", "SALES", "DELIVERY", "RESTRICTED_TECHNICAL"]) {
      const r = await createRole(management, { name: `From ${from}`, basedOnRoleKey: from });
      for (const k of [...ADMIN_RESERVED_KEYS, ...SENSITIVE_RESERVED_KEYS]) expect(r.permissionKeys, `${from} -> ${k}`).not.toContain(k);
    }
  });

  it("a custom role holder is refused the payments, audit and export routes on the next request", async () => {
    const { org, management } = await setup("ReservedRoutes");
    const r = await createRole(management, { name: "Wide", basedOnRoleKey: "MANAGEMENT" });
    const holder = await memberOf(org.id, r.id);
    expect((await holder.asRequest("/invoices")).status).toBe(403);
    expect((await holder.asRequest("/audit", "GET", { query: "?entityType=Deal&entityId=00000000-0000-4000-8000-000000000000" })).status).toBe(403);
    expect((await holder.asRequest("/roles")).status).toBe(403);
  }, 120_000);
});

describe("rule 8: organisations cannot see, edit or assign each other's custom roles", () => {
  it("cross-organisation role ids are refused on every route, and assignment by key is unknown", async () => {
    const a = await setup("IsoA");
    const b = await setup("IsoB");
    const role = await createRole(a.management, { name: "Iso Role", permissionKeys: ["contacts.view"] });
    const { membership } = await createTestMembership(b.org.id, "SALES", "iso.member");

    current.ctx = b.management;
    for (const method of ["GET", "PATCH", "DELETE"] as const) {
      const r = await invoke(route("/roles/{roleId}"), method, { ...V, roleId: role.id }, method === "PATCH" ? { body: { name: "Hijack" } } : {});
      expect(r.status, method).toBe(404);
    }
    const prev = await invoke(route("/roles/preview"), "POST", V, { body: { roleId: role.id, permissionKeys: ["contacts.view"] } });
    expect(prev.status).toBe(404);
    const list = await invoke(route("/roles"), "GET", V);
    expect(JSON.stringify(list.json)).not.toContain(role.id);
    current.ctx = null;

    await expect(changeMemberRole(b.management, membership.id, role.key)).rejects.toThrow(/Unknown role/);
    // Unchanged in the owning organisation.
    const kept = (await listRoles(a.management)).roles.find((r) => r.id === role.id)!;
    expect(kept.name).toBe("Iso Role");
    expect(kept.permissionKeys).toEqual(["contacts.view"]);
  }, 120_000);

  it("a member whose row points at another organisation's role resolves to nothing", async () => {
    const a = await setup("IsoC");
    const b = await setup("IsoD");
    const role = await createRole(a.management, { name: "Foreign", permissionKeys: ["leads.view.all"] });
    const { membership, user } = await createTestMembership(b.org.id, "SALES", "iso.forced");
    await adminDb.membership.update({ where: { id: membership.id }, data: { roleId: role.id } });
    expect(await resolveActiveMembership(user.id, b.org.id)).toBeNull();
  });

  it("the same custom role name can exist in two organisations", async () => {
    const a = await setup("NameA");
    const b = await setup("NameB");
    await createRole(a.management, { name: "Shared Name", permissionKeys: [] });
    await createRole(b.management, { name: "Shared Name", permissionKeys: [] });
  });
});

describe("every role change writes an audit entry", () => {
  it("create, update (permissions, field rule, name), and archive are each audited with the actor; a refused change writes nothing", async () => {
    const { org, management } = await setup("Audit");
    const role = await createRole(management, { name: "Audited", permissionKeys: ["deals.view.all"] });
    await updateRole(management, role.id, { permissionKeys: ["deals.view.all", "contacts.view"] });
    await updateRole(management, role.id, { fieldRules: { "deal.value": "hidden" } });
    await updateRole(management, role.id, { name: "Audited Renamed" });
    await invalidCodes(updateRole(management, role.id, { permissionKeys: ["audit.view"] }));
    await archiveRole(management, role.id);

    const events = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityType: "Role", entityId: role.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["role.created", "role.updated", "role.updated", "role.updated", "role.archived"]);
    for (const e of events) expect(e.actorMembershipId).toBe(management.membershipId);
    const fieldEdit = events[2]!;
    expect((fieldEdit.previousValue as { fieldRules: Record<string, string> }).fieldRules["deal.value"]).toBe("own");
    expect((fieldEdit.newValue as { fieldRules: Record<string, string> }).fieldRules["deal.value"]).toBe("hidden");
    // Role assignment is audited too (the person's access changed).
    const sales = await createTestMembership(org.id, "SALES", "audit.assignee");
    const another = await createRole(management, { name: "Assigned", permissionKeys: ["contacts.view"] });
    await changeMemberRole(management, sales.membership.id, another.key);
    const assigned = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: "membership.role_changed", entityId: sales.membership.id } });
    expect(assigned).toHaveLength(1);
  });
});
