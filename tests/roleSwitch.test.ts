import { describe, expect, it } from "vitest";
import { resolveActiveMembership } from "../src/repositories/memberships";
import { changeMemberRole } from "../src/services/membershipService";
import { createTestContext, createTestMembership, createTestOrganization } from "./helpers/fixtures";

/**
 * Switching a member's role in Settings -> Members changes what they can reach, at once, and never needs a new sign-in.
 * Sales <-> Marketing is the case the business asked for. DB-backed (needs the test database).
 */
describe("role switch: Sales to Marketing and back", () => {
  it("moves the keys with the role and writes the change to the same membership", async () => {
    const org = await createTestOrganization("RoleSwitch");
    const admin = await createTestContext(org.id, "MANAGEMENT");
    const { user, membership } = await createTestMembership(org.id, "SALES", "mark.mutesa");

    const before = (await resolveActiveMembership(user.id, org.id))!;
    expect(before.permissionKeys).toEqual(expect.arrayContaining(["deals.edit.own", "invoices.create"]));
    expect(before.permissionKeys).not.toContain("social.view");

    await changeMemberRole(admin, membership.id, "MARKETING");
    const asMarketing = (await resolveActiveMembership(user.id, org.id))!;
    expect(asMarketing.roleKey).toBe("MARKETING");
    expect(asMarketing.permissionKeys).toEqual(expect.arrayContaining(["social.view", "social.publish", "leads.create"]));
    for (const k of ["invoices.view", "invoices.create", "deals.edit.own", "finance.view.payments"]) {
      expect(asMarketing.permissionKeys, k).not.toContain(k);
    }

    await changeMemberRole(admin, membership.id, "SALES");
    const back = (await resolveActiveMembership(user.id, org.id))!;
    expect(back.permissionKeys).toEqual(expect.arrayContaining(["deals.edit.own", "invoices.create"]));
    expect(back.permissionKeys).not.toContain("social.view");
  });

  it("is refused to a Sales member, who cannot assign roles", async () => {
    const org = await createTestOrganization("RoleSwitchDeny");
    const sales = await createTestContext(org.id, "SALES");
    const { membership } = await createTestMembership(org.id, "DELIVERY");
    await expect(changeMemberRole(sales, membership.id, "MARKETING")).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});
