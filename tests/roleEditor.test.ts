import { describe, expect, it } from "vitest";
import { maskDeal } from "../src/auth/masking";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import type { AuthContext } from "../src/auth/context";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { resolveActiveMembership } from "../src/repositories/memberships";
import * as companyService from "../src/services/companyService";
import * as dealService from "../src/services/dealService";
import { setOrganizationRelease } from "../src/services/featureService";
import { changeMemberRole } from "../src/services/membershipService";
import { archiveRole, createRole, getRole, getRoleCatalog, listRoles, previewRole, updateRole } from "../src/services/roleEditorService";
import { ADMIN_RESERVED_KEYS, SENSITIVE_RESERVED_KEYS, grantableKeys, reconcileFieldRules, validatePermissionKeys } from "../src/lib/roleLimits";
import { createTestContext, createTestMembership, createTestOrganization, getPipelineStageId } from "./helpers/fixtures";

/**
 * FIG-1188 (B7.06): the roles and field access editor. Limits, immediate effect, audit, field rules through the masking layer,
 * the last-Management safeguard, platform roles untouched, and tenant isolation (service and row-level security).
 */

type DealRow = { ownerMembershipId: string | null; value: unknown };

async function setup() {
  const org = await createTestOrganization("Roles");
  await setOrganizationRelease(org.id, "v2");
  const management = await createTestContext(org.id, "MANAGEMENT");
  return { org, management };
}

async function ctxWithRole(organizationId: string, roleId: string, prefix = "custom.member"): Promise<AuthContext> {
  const { membership, user } = await createTestMembership(organizationId, "SALES", prefix);
  await adminDb.membership.update({ where: { id: membership.id }, data: { roleId } });
  const ctx = await resolveActiveMembership(user.id, organizationId);
  if (!ctx) throw new Error("expected an active membership");
  return ctx;
}

async function expectInvalid(p: Promise<unknown>, code: string) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(ValidationError);
  expect((err as ValidationError).issues?.some((i) => i.code === code), JSON.stringify((err as ValidationError).issues)).toBe(true);
}

describe("limits (pure)", () => {
  it("never offers a reserved key and keeps the catalogue otherwise whole", () => {
    const grantable = new Set(grantableKeys());
    for (const k of [...ADMIN_RESERVED_KEYS, ...SENSITIVE_RESERVED_KEYS]) expect(grantable.has(k), k).toBe(false);
    expect(grantable.has("leads.view.own")).toBe(true);
    expect(grantable.has("deals.view.value")).toBe(true);
  });

  it("explains a change right without a view right, and lets a complete set through", () => {
    expect(validatePermissionKeys(["leads.edit.all"]).map((i) => i.code)).toEqual(["MISSING_VIEW_PERMISSION"]);
    expect(validatePermissionKeys(["leads.edit.all", "leads.view.all"])).toEqual([]);
    expect(validatePermissionKeys(["nope.nothing"]).map((i) => i.code)).toEqual(["UNKNOWN_PERMISSION"]);
  });

  it("lets the field rule decide the value key", () => {
    expect(reconcileFieldRules(["deals.view.all"], { "deal.value": "all" })).toEqual({ keys: ["deals.view.all", "deals.view.value"], rules: { "deal.value": "all" } });
    expect(reconcileFieldRules(["deals.view.all", "deals.view.value"], { "deal.value": "hidden" }).keys).toEqual(["deals.view.all"]);
    expect(reconcileFieldRules(["deals.view.value", "deals.view.all"], {}).rules).toEqual({ "deal.value": "all" });
    expect(reconcileFieldRules(["deals.view.all"], {}).rules).toEqual({ "deal.value": "own" });
  });
});

describe("custom roles", () => {
  it("creates a role from a platform role, drops reserved keys, and audits it", async () => {
    const { org, management } = await setup();
    const role = await createRole(management, { name: "Field Sales", basedOnRoleKey: "MANAGEMENT" });
    expect(role.kind).toBe("custom");
    expect(role.editable).toBe(true);
    expect(role.permissionKeys).toContain("leads.view.all");
    for (const k of [...ADMIN_RESERVED_KEYS, ...SENSITIVE_RESERVED_KEYS]) expect(role.permissionKeys, k).not.toContain(k);

    const events = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityType: "Role", entityId: role.id } });
    expect(events.map((e) => e.action)).toEqual(["role.created"]);
    expect((events[0]!.newValue as { name: string }).name).toBe("Field Sales");
  });

  it("refuses reserved keys, payments, a missing view right and duplicate or platform names", async () => {
    const { management } = await setup();
    await expectInvalid(createRole(management, { name: "Sneaky", permissionKeys: ["finance.view.payments"] }), "RESERVED_PERMISSION");
    await expectInvalid(createRole(management, { name: "Sneaky", permissionKeys: ["roles.manage"] }), "RESERVED_PERMISSION");
    await expectInvalid(createRole(management, { name: "Sneaky", permissionKeys: ["deals.margin"] }), "RESERVED_PERMISSION");
    await expectInvalid(createRole(management, { name: "Sneaky", permissionKeys: ["leads.edit.all"] }), "MISSING_VIEW_PERMISSION");
    await expectInvalid(createRole(management, { name: "Finance", permissionKeys: [] }), "NAME_TAKEN");
    await createRole(management, { name: "Twin", permissionKeys: ["contacts.view"] });
    await expectInvalid(createRole(management, { name: "twin", permissionKeys: ["contacts.view"] }), "NAME_TAKEN");
  });

  it("is for Management only", async () => {
    const { org } = await setup();
    const sales = await createTestContext(org.id, "SALES", "sales.actor");
    await expect(createRole(sales, { name: "Nope" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getRoleCatalog(sales)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listRoles(sales)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("fixes the platform roles", async () => {
    const { management } = await setup();
    const { roles } = await listRoles(management);
    const sales = roles.find((r) => r.key === "SALES")!;
    expect(sales.kind).toBe("platform");
    expect(sales.editable).toBe(false);
    await expectInvalid(updateRole(management, sales.id, { permissionKeys: ["leads.view.all"] }), "PLATFORM_ROLE_FIXED");
    await expectInvalid(archiveRole(management, sales.id), "PLATFORM_ROLE_FIXED");
    expect(roles.filter((r) => r.kind === "platform").map((r) => r.key)).toEqual(["MANAGEMENT", "SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL"]);
  });

  it("takes effect on the very next request, and an edit is audited with before and after", async () => {
    const { org, management } = await setup();
    const role = await createRole(management, { name: "Reader", permissionKeys: ["leads.view.all", "contacts.view"] });
    const member = await ctxWithRole(org.id, role.id);
    expect(member.permissionKeys).toContain("leads.view.all");
    expect(member.permissionKeys).not.toContain("leads.create");

    await updateRole(management, role.id, { permissionKeys: ["leads.view.all", "leads.create", "contacts.view"] });
    const after = await resolveActiveMembership(member.userId, org.id);
    expect(after!.permissionKeys).toContain("leads.create");

    await updateRole(management, role.id, { permissionKeys: ["contacts.view"] });
    const lost = await resolveActiveMembership(member.userId, org.id);
    expect(lost!.permissionKeys).not.toContain("leads.view.all");

    const events = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityId: role.id, action: "role.updated" }, orderBy: { createdAt: "asc" } });
    expect(events).toHaveLength(2);
    expect((events[1]!.previousValue as { permissionKeys: string[] }).permissionKeys).toContain("leads.create");
    expect((events[1]!.newValue as { permissionKeys: string[] }).permissionKeys).toEqual(["contacts.view"]);
    expect((events[0]!.metadata as { membersAffected: number }).membersAffected).toBe(1);
  });

  it("removes a departure's keys from a custom role while the departure is off", async () => {
    const { org, management } = await setup();
    const role = await createRole(management, { name: "Claimer", permissionKeys: ["leads.view.own", "leads.view.shared", "leads.claim"] });
    const member = await ctxWithRole(org.id, role.id);
    // The shared-pool departure is on by default in the seeded matrix; switch it off for this organisation.
    await adminDb.organizationSetting.upsert({
      where: { organizationId_key: { organizationId: org.id, key: "feature_toggles" } },
      update: { value: { "departure.shared_pool": false } },
      create: { organizationId: org.id, key: "feature_toggles", value: { "departure.shared_pool": false } },
    });
    const off = await resolveActiveMembership(member.userId, org.id);
    expect(off!.permissionKeys).not.toContain("leads.claim");
    expect(off!.permissionKeys).toContain("leads.view.own");
  });
});

describe("assignment and the Management safeguard", () => {
  it("assigns a custom role to a member, and refuses another organisation's role as unknown", async () => {
    const { org, management } = await setup();
    const other = await setup();
    const mine = await createRole(management, { name: "Mine", permissionKeys: ["contacts.view"] });
    const theirs = await createRole(other.management, { name: "Theirs", permissionKeys: ["contacts.view"] });
    const { membership } = await createTestMembership(org.id, "SALES", "assignee");

    await changeMemberRole(management, membership.id, mine.key);
    const row = await adminDb.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(row.roleId).toBe(mine.id);

    await expect(changeMemberRole(management, membership.id, theirs.key)).rejects.toThrow(/Unknown role/);
  });

  it("still refuses to move the last Management member away, to a custom role too", async () => {
    const { management } = await setup();
    const role = await createRole(management, { name: "Almost Management", basedOnRoleKey: "MANAGEMENT" });
    await expect(changeMemberRole(management, management.membershipId, role.key)).rejects.toThrow(/last active Management/);
  });

  it("archives a role nobody holds, refuses while it is held, and an archived role grants nothing", async () => {
    const { org, management } = await setup();
    const role = await createRole(management, { name: "Short Lived", permissionKeys: ["contacts.view"] });
    const member = await ctxWithRole(org.id, role.id);
    await expectInvalid(archiveRole(management, role.id), "ROLE_IN_USE");
    expect((await getRole(management, role.id)).memberCount).toBe(1);

    await adminDb.membership.update({ where: { id: member.membershipId }, data: { status: "REMOVED" } });
    await archiveRole(management, role.id);
    expect((await listRoles(management)).roles.some((r) => r.id === role.id)).toBe(false);
    expect((await listRoles(management, { includeArchived: true })).roles.some((r) => r.id === role.id)).toBe(true);
    await expect(updateRole(management, role.id, { name: "Back" })).rejects.toBeInstanceOf(NotFoundError);

    // Even a membership that somehow still points at an archived role resolves to nothing.
    await adminDb.membership.update({ where: { id: member.membershipId }, data: { status: "ACTIVE" } });
    expect(await resolveActiveMembership(member.userId, org.id)).toBeNull();
    // ...and its name is free again.
    await createRole(management, { name: "Short Lived", permissionKeys: ["contacts.view"] });
  });
});

describe("field access through the masking layer", () => {
  it("shows the value as the field rule says: all, own, or hidden even from the owner", async () => {
    const { org, management } = await setup();
    const { company } = await companyService.createCompany(management, { name: "Field Co" });
    const stageId = await getPipelineStageId(org.id);

    const mk = async (name: string, access: "all" | "own" | "hidden") => {
      const role = await createRole(management, {
        name,
        permissionKeys: ["deals.view.own", "deals.view.all", "deals.create", "companies.view"],
        fieldRules: { "deal.value": access },
      });
      return { role, ctx: await ctxWithRole(org.id, role.id, name.toLowerCase().replace(/\s/g, ".")) };
    };
    const all = await mk("Sees All", "all");
    const own = await mk("Sees Own", "own");
    const hidden = await mk("Sees None", "hidden");

    const ownDeal = await dealService.createDeal(own.ctx, { companyId: company.id, pipelineStageId: stageId, value: 11111, currency: "KES" });
    const hiddenOwnDeal = await dealService.createDeal(hidden.ctx, { companyId: company.id, pipelineStageId: stageId, value: 22222, currency: "KES" });

    expect(all.ctx.permissionKeys).toContain("deals.view.value");
    expect(own.ctx.permissionKeys).not.toContain("deals.view.value");
    expect(own.ctx.hiddenFields).toBeUndefined();
    expect(hidden.ctx.hiddenFields).toEqual(["deal.value"]);

    // all: every value.
    expect(maskDeal(all.ctx, ownDeal as DealRow).valueMasked).toBe(false);
    // own: the owner sees their deal's value, not someone else's.
    expect(maskDeal(own.ctx, ownDeal as DealRow).valueMasked).toBe(false);
    expect(maskDeal(own.ctx, hiddenOwnDeal as DealRow).valueMasked).toBe(true);
    // hidden: not even the owner, on every read path.
    expect(maskDeal(hidden.ctx, hiddenOwnDeal as DealRow).valueMasked).toBe(true);
    const viaService = await dealService.getDeal(hidden.ctx, hiddenOwnDeal.id);
    expect((viaService as { value: unknown }).value).toBeNull();
    const list = (await dealService.listDeals(hidden.ctx)) as Array<{ id: string; value: unknown }>;
    expect(list.find((d) => d.id === hiddenOwnDeal.id)?.value).toBeNull();
  });

  it("refuses to open margin or payments through a field rule", async () => {
    const { management } = await setup();
    await expectInvalid(createRole(management, { name: "Margin", permissionKeys: ["deals.view.all"], fieldRules: { "deal.margin": "all" } }), "FIELD_FIXED");
    await expectInvalid(createRole(management, { name: "Payments", permissionKeys: ["deals.view.all"], fieldRules: { payments: "all" } }), "FIELD_FIXED");
    await expectInvalid(createRole(management, { name: "Unknown", permissionKeys: [], fieldRules: { "lead.phone": "hidden" } }), "UNKNOWN_FIELD");
    await expectInvalid(createRole(management, { name: "Odd", permissionKeys: ["deals.view.all"], fieldRules: { "deal.value": "sometimes" } }), "BAD_ACCESS");
  });
});

describe("preview of effect", () => {
  it("describes the change without writing anything", async () => {
    const { org, management } = await setup();
    const role = await createRole(management, { name: "Previewed", permissionKeys: ["leads.view.own", "contacts.view"] });
    await ctxWithRole(org.id, role.id, "previewed.member");

    const p = await previewRole(management, { roleId: role.id, permissionKeys: ["leads.view.all", "leads.edit.all", "contacts.view"] });
    expect(p.gained).toEqual(["leads.edit.all", "leads.view.all"]);
    expect(p.lost).toEqual(["leads.view.own"]);
    expect(p.people).toEqual({ count: 1, names: ["Test User"] });
    const leadsView = p.scopes.find((s) => s.resource === "leads" && s.action === "view")!;
    expect(leadsView).toMatchObject({ scope: "organisation", changed: true });
    expect(p.scopes.find((s) => s.resource === "contacts" && s.action === "view")!.changed).toBe(false);

    const saved = await getRole(management, role.id);
    expect(saved.permissionKeys).toEqual(["contacts.view", "leads.view.own"]);
    const events = await adminDb.auditEvent.count({ where: { organizationId: org.id, entityId: role.id, action: "role.updated" } });
    expect(events).toBe(0);
  });

  it("warns, and answers an invalid proposal the way saving would", async () => {
    const { management } = await setup();
    const p = await previewRole(management, { permissionKeys: [], fieldRules: { "deal.value": "hidden" } });
    expect(p.warnings.length).toBe(2);
    await expectInvalid(previewRole(management, { permissionKeys: ["audit.view"] }), "RESERVED_PERMISSION");
  });
});

describe("tenant isolation", () => {
  it("hides one organisation's custom roles from another, in the service and in the database", async () => {
    const a = await setup();
    const b = await setup();
    const role = await createRole(a.management, { name: "Org A Only", permissionKeys: ["contacts.view"], fieldRules: { "deal.value": "hidden" } });

    // Service layer: another organisation's Management cannot read, change, preview against or archive it.
    await expect(getRole(b.management, role.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateRole(b.management, role.id, { name: "Hijacked" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(archiveRole(b.management, role.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(previewRole(b.management, { roleId: role.id })).rejects.toBeInstanceOf(NotFoundError);
    expect((await listRoles(b.management)).roles.some((r) => r.id === role.id)).toBe(false);

    // Database layer: the tenant role, with organisation B in context, cannot see A's rows, but sees the platform roles.
    const seen = await withOrgContext(b.org.id, async (tx) => ({
      roles: await tx.role.findMany({ select: { id: true, key: true, organizationId: true } }),
      permissions: await tx.rolePermission.count({ where: { roleId: role.id } }),
      rules: await tx.roleFieldRule.count({ where: { roleId: role.id } }),
    }));
    expect(seen.roles.some((r) => r.id === role.id)).toBe(false);
    expect(seen.roles.filter((r) => r.organizationId === null).length).toBeGreaterThanOrEqual(5);
    expect(seen.permissions).toBe(0);
    expect(seen.rules).toBe(0);

    const own = await withOrgContext(a.org.id, async (tx) => ({
      role: await tx.role.findUnique({ where: { id: role.id } }),
      permissions: await tx.rolePermission.count({ where: { roleId: role.id } }),
      rules: await tx.roleFieldRule.count({ where: { roleId: role.id } }),
    }));
    expect(own.role?.name).toBe("Org A Only");
    expect(own.permissions).toBe(1);
    expect(own.rules).toBe(1);

    // And the tenant role cannot write a role for somebody else's organisation.
    await expect(
      withOrgContext(b.org.id, (tx) => tx.role.create({ data: { key: `custom_probe_${Date.now()}`, name: "Probe", isSystem: false, organizationId: a.org.id } })),
    ).rejects.toThrow();
  });
});
