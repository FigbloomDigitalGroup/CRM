import { describe, expect, it } from "vitest";
import { resolveActiveMembership } from "../src/repositories/memberships";
import { changeMemberRole } from "../src/services/membershipService";
import { getMemberAccess, setMemberAccess } from "../src/services/memberAccessService";
import { setOrganizationRelease } from "../src/services/featureService";
import { withOrgContext } from "../src/db/orgScopedClient";
import { adminDb } from "../src/db/adminClient";
import { createTestContext, createTestMembership, createTestOrganization } from "./helpers/fixtures";

/** UC-C5 step 3 (FIG-1790): per-member permission overrides on top of the role. DB-backed. */
async function setup(name: string) {
  const org = await createTestOrganization(name);
  await setOrganizationRelease(org.id, "v2");
  const admin = await createTestContext(org.id, "MANAGEMENT");
  const sales = await createTestMembership(org.id, "SALES", "mark.mutesa");
  return { org, admin, sales };
}
const keysOf = async (userId: string, orgId: string) => (await resolveActiveMembership(userId, orgId))!.permissionKeys;

describe("membership permission overrides", () => {
  it("a GRANT adds a key and a DENY removes one, on top of the role", async () => {
    const { org, admin, sales } = await setup("OverrideResolve");
    const before = await keysOf(sales.user.id, org.id);
    expect(before).not.toContain("social.view");
    expect(before).toContain("invoices.create");

    const out = await setMemberAccess(admin, sales.membership.id, { grant: ["social.view"], deny: ["invoices.create"] });
    expect(out.grant).toEqual(["social.view"]);
    expect(out.deny).toEqual(["invoices.create"]);
    const after = await keysOf(sales.user.id, org.id);
    expect(after).toContain("social.view");
    expect(after).not.toContain("invoices.create");
    expect(out.effectiveKeys).toEqual(after);

    // Idempotent, and Reset (empty sets) returns the role's own keys.
    await setMemberAccess(admin, sales.membership.id, { grant: ["social.view"], deny: ["invoices.create"] });
    expect(await keysOf(sales.user.id, org.id)).toEqual(after);
    await setMemberAccess(admin, sales.membership.id, { grant: [], deny: [] });
    expect(await keysOf(sales.user.id, org.id)).toEqual(before);

    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: "membership.permissions_overridden" } });
    expect(audit).toHaveLength(2); // the repeat of identical overrides is not audited twice
  });

  it("refuses to GRANT platform-only or payment keys, unknown keys and conflicts", async () => {
    const { admin, sales } = await setup("OverrideForbidden");
    for (const key of ["roles.manage", "membership.manage", "finance.view.payments", "payments.record", "deals.margin"]) {
      await expect(setMemberAccess(admin, sales.membership.id, { grant: [key], deny: [] })).rejects.toMatchObject({ name: "ValidationError" });
    }
    await expect(setMemberAccess(admin, sales.membership.id, { grant: ["nope.nothing"], deny: [] })).rejects.toMatchObject({ name: "ValidationError" });
    await expect(setMemberAccess(admin, sales.membership.id, { grant: ["social.view"], deny: ["social.view"] })).rejects.toMatchObject({ name: "ValidationError" });
  });

  it("a granted key the grantor does not hold is refused", async () => {
    const { org, sales } = await setup("OverrideGrantor");
    // A Management-level actor stripped of social.view by hand cannot hand it out (the rule is general: the grantor must hold the key).
    const admin = await createTestContext(org.id, "MANAGEMENT");
    const without = { ...admin, permissionKeys: admin.permissionKeys.filter((k) => k !== "social.view") };
    await expect(setMemberAccess(without, sales.membership.id, { grant: ["social.view"], deny: [] })).rejects.toMatchObject({ name: "ValidationError" });
  });

  it("a view right removed while its change rights stay is refused", async () => {
    const { admin, sales } = await setup("OverrideNeedsView");
    await expect(setMemberAccess(admin, sales.membership.id, { grant: [], deny: ["invoices.view"] })).rejects.toMatchObject({ name: "ValidationError" });
  });

  it("the Management role keeps the keys that run the organisation", async () => {
    const { org, admin } = await setup("OverrideMgmt");
    const other = await createTestMembership(org.id, "MANAGEMENT", "second.manager");
    await expect(setMemberAccess(admin, other.membership.id, { grant: [], deny: ["roles.manage"] })).rejects.toMatchObject({ name: "ValidationError" });
    await expect(setMemberAccess(admin, other.membership.id, { grant: [], deny: ["role.assign"] })).rejects.toMatchObject({ name: "ValidationError" });
  });

  it("refuses your own overrides", async () => {
    const { admin } = await setup("OverrideSelf");
    await expect(setMemberAccess(admin, admin.membershipId, { grant: [], deny: ["social.view"] })).rejects.toMatchObject({ name: "ValidationError" });
  });

  it("only Management can read or edit overrides", async () => {
    const { org, sales } = await setup("OverrideRoles");
    const salesCtx = (await resolveActiveMembership(sales.user.id, org.id))!;
    const other = await createTestMembership(org.id, "SALES", "second.sales");
    await expect(setMemberAccess(salesCtx, other.membership.id, { grant: ["social.view"], deny: [] })).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(getMemberAccess(salesCtx, other.membership.id)).rejects.toMatchObject({ name: "ForbiddenError" });
  });

  it("a membership of another organisation cannot be edited or read", async () => {
    const { admin } = await setup("OverrideOrgA");
    const b = await setup("OverrideOrgB");
    await expect(setMemberAccess(admin, b.sales.membership.id, { grant: ["social.view"], deny: [] })).rejects.toMatchObject({ name: "NotFoundError" });
    await expect(getMemberAccess(admin, b.sales.membership.id)).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("changing the member's role keeps the overrides (documented choice)", async () => {
    const { org, admin, sales } = await setup("OverrideRoleChange");
    await setMemberAccess(admin, sales.membership.id, { grant: ["social.view"], deny: ["invoices.create"] });
    await changeMemberRole(admin, sales.membership.id, "MARKETING");
    const keys = await keysOf(sales.user.id, org.id);
    expect(keys).toContain("social.view");
    expect(keys).not.toContain("invoices.create");
    expect((await getMemberAccess(admin, sales.membership.id)).grant).toEqual(["social.view"]);
  });

  it("RLS: another organisation cannot read the rows", async () => {
    const { admin, sales } = await setup("OverrideRlsA");
    const b = await setup("OverrideRlsB");
    await setMemberAccess(admin, sales.membership.id, { grant: ["social.view"], deny: [] });
    const seenByB = await withOrgContext(b.org.id, (tx) => tx.membershipPermissionOverride.findMany({}));
    expect(seenByB).toHaveLength(0);
    await expect(
      withOrgContext(b.org.id, (tx) =>
        tx.membershipPermissionOverride.create({ data: { organizationId: sales.membership.organizationId, membershipId: sales.membership.id, permissionKey: "x", effect: "GRANT" } }),
      ),
    ).rejects.toBeTruthy();
  });
});
