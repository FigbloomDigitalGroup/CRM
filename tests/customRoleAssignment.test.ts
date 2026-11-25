import { describe, expect, it } from "vitest";
import { resolveActiveMembership } from "../src/repositories/memberships";
import { changeMemberRole } from "../src/services/membershipService";
import { setOrganizationRelease } from "../src/services/featureService";
import { archiveRole, createRole } from "../src/services/roleEditorService";
import { createTestContext, createTestMembership, createTestOrganization } from "./helpers/fixtures";

/** A custom role made in Settings -> Roles & access can be given to a member in Settings -> Members, and the member's keys are then the role's keys. DB-backed. */
describe("custom role assignment", () => {
  const KEYS = ["leads.view.own", "leads.create", "tasks.view.own"];

  it("gives the member exactly the custom role's keys", async () => {
    const org = await createTestOrganization("CustomRoleAssign");
    await setOrganizationRelease(org.id, "v2");
    const admin = await createTestContext(org.id, "MANAGEMENT");
    const { user, membership } = await createTestMembership(org.id, "SALES", "mark.mutesa");
    const role = await createRole(admin, { name: "Lead desk", permissionKeys: KEYS });
    await changeMemberRole(admin, membership.id, role.key);
    const after = (await resolveActiveMembership(user.id, org.id))!;
    expect(after.roleKey).toBe(role.key);
    expect([...after.permissionKeys].sort()).toEqual([...role.permissionKeys].sort());
    expect(after.permissionKeys).not.toContain("invoices.create");
  });

  it("refuses an archived role and a role of another organisation", async () => {
    const org = await createTestOrganization("CustomRoleArchive");
    await setOrganizationRelease(org.id, "v2");
    const other = await createTestOrganization("CustomRoleOther");
    await setOrganizationRelease(other.id, "v2");
    const admin = await createTestContext(org.id, "MANAGEMENT");
    const otherAdmin = await createTestContext(other.id, "MANAGEMENT");
    const { membership } = await createTestMembership(org.id, "SALES");
    const mine = await createRole(admin, { name: "Old desk", permissionKeys: KEYS });
    const foreign = await createRole(otherAdmin, { name: "Foreign desk", permissionKeys: KEYS });
    await archiveRole(admin, mine.id);
    await expect(changeMemberRole(admin, membership.id, mine.key)).rejects.toMatchObject({ name: "ValidationError" });
    await expect(changeMemberRole(admin, membership.id, foreign.key)).rejects.toMatchObject({ name: "ValidationError" });
  });

  it("cannot create a role with platform-only keys", async () => {
    const org = await createTestOrganization("CustomRoleReserved");
    await setOrganizationRelease(org.id, "v2");
    const admin = await createTestContext(org.id, "MANAGEMENT");
    await expect(createRole(admin, { name: "Sneaky", permissionKeys: ["roles.manage"] })).rejects.toMatchObject({ name: "ValidationError" });
  });
});
