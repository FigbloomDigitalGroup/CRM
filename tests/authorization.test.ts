import { describe, expect, it } from "vitest";
import {
  addMembership,
  deactivateMembership,
  resolveActiveMembership,
} from "../src/repositories/memberships";
import { createTestOrganization, createTestUser } from "./helpers/fixtures";

describe("authorization foundation", () => {
  it("resolves an active membership's role and permission set", async () => {
    const org = await createTestOrganization();
    const user = await createTestUser();
    await addMembership({
      organizationId: org.id,
      userId: user.id,
      roleKey: "SALES",
    });

    const resolved = await resolveActiveMembership(user.id, org.id);
    expect(resolved).not.toBeNull();
    expect(resolved?.roleKey).toBe("SALES");
    expect(resolved?.permissionKeys).toContain("leads.create");
  });

  it("denies resolution for a user with no membership in the organization (fail closed)", async () => {
    const org = await createTestOrganization();
    const user = await createTestUser();
    const resolved = await resolveActiveMembership(user.id, org.id);
    expect(resolved).toBeNull();
  });

  it("denies resolution once a membership is deactivated", async () => {
    const org = await createTestOrganization();
    const user = await createTestUser();
    const membership = await addMembership({
      organizationId: org.id,
      userId: user.id,
      roleKey: "SALES",
    });

    await deactivateMembership(membership.id);

    const resolved = await resolveActiveMembership(user.id, org.id);
    expect(resolved).toBeNull();
  });

  it("does not leak a user's membership from one organization into another", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const user = await createTestUser();
    await addMembership({
      organizationId: orgA.id,
      userId: user.id,
      roleKey: "SALES",
    });

    const resolvedInB = await resolveActiveMembership(user.id, orgB.id);
    expect(resolvedInB).toBeNull();
  });

  it("supports the same user holding independent memberships (and roles) in two organizations", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const user = await createTestUser();
    await addMembership({
      organizationId: orgA.id,
      userId: user.id,
      roleKey: "SALES",
    });
    await addMembership({
      organizationId: orgB.id,
      userId: user.id,
      roleKey: "MANAGEMENT",
    });

    const inA = await resolveActiveMembership(user.id, orgA.id);
    const inB = await resolveActiveMembership(user.id, orgB.id);

    expect(inA?.roleKey).toBe("SALES");
    expect(inB?.roleKey).toBe("MANAGEMENT");
  });

  it("enforces role permission boundaries: Finance lacks pipeline-editing permissions, Sales lacks finance permissions", async () => {
    const org = await createTestOrganization();
    const financeUser = await createTestUser("finance");
    const salesUser = await createTestUser("sales");
    await addMembership({
      organizationId: org.id,
      userId: financeUser.id,
      roleKey: "FINANCE",
    });
    await addMembership({
      organizationId: org.id,
      userId: salesUser.id,
      roleKey: "SALES",
    });

    const finance = await resolveActiveMembership(financeUser.id, org.id);
    const sales = await resolveActiveMembership(salesUser.id, org.id);

    expect(finance?.permissionKeys).not.toContain("deals.edit.all");
    expect(finance?.permissionKeys).not.toContain("leads.create");
    expect(finance?.permissionKeys).toContain("finance.manage.payments");

    expect(sales?.permissionKeys).not.toContain("finance.view.payments");
    expect(sales?.permissionKeys).not.toContain("finance.manage.payments");
    expect(sales?.permissionKeys).not.toContain("configuration.manage");
  });

  it("restricts Restricted Technical to the smallest permission set of all V1 roles", async () => {
    const org = await createTestOrganization();
    const techUser = await createTestUser("tech");
    await addMembership({
      organizationId: org.id,
      userId: techUser.id,
      roleKey: "RESTRICTED_TECHNICAL",
    });

    const tech = await resolveActiveMembership(techUser.id, org.id);
    expect(tech?.permissionKeys.length).toBeGreaterThan(0);
    expect(tech?.permissionKeys).not.toContain("leads.view.all");
    expect(tech?.permissionKeys).not.toContain("companies.export");
    expect(tech?.permissionKeys).not.toContain("audit.view");
  });

  it("prevents adding a second active membership for the same user in the same organization", async () => {
    const org = await createTestOrganization();
    const user = await createTestUser();
    await addMembership({
      organizationId: org.id,
      userId: user.id,
      roleKey: "SALES",
    });

    await expect(
      addMembership({
        organizationId: org.id,
        userId: user.id,
        roleKey: "MANAGEMENT",
      }),
    ).rejects.toThrow();
  });
});
