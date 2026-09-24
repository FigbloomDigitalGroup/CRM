import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES } from "../prisma/seedData";
import { seedOrganizationDefaults } from "../src/services/organizationDefaults";
import { createTestOrganization } from "./helpers/fixtures";

describe("seed data", () => {
  it("has exactly the five required V1 roles", async () => {
    const roles = await adminDb.role.findMany();
    expect(roles.map((r) => r.key).sort()).toEqual(
      [...ROLES.map((r) => r.key)].sort(),
    );
  });

  it("has the full permission catalog", async () => {
    const count = await adminDb.permission.count();
    expect(count).toBe(PERMISSIONS.length);
  });

  it("maps each role to exactly its expected permission set", async () => {
    for (const [roleKey, expectedKeys] of Object.entries(ROLE_PERMISSIONS)) {
      const role = await adminDb.role.findUniqueOrThrow({
        where: { key: roleKey },
        include: { rolePermissions: { include: { permission: true } } },
      });
      const actualKeys = role.rolePermissions
        .map((rp) => rp.permission.key)
        .sort();
      expect(actualKeys).toEqual([...expectedKeys].sort());
    }
  });

  it("seeds a full controlled-value catalog for a new organization", async () => {
    const org = await createTestOrganization("Catalog Check");

    expect(
      await adminDb.leadSource.count({ where: { organizationId: org.id } }),
    ).toBeGreaterThan(0);
    expect(
      await adminDb.leadStatus.count({ where: { organizationId: org.id } }),
    ).toBeGreaterThan(0);
    expect(
      await adminDb.pipelineStage.count({ where: { organizationId: org.id } }),
    ).toBeGreaterThan(0);
    expect(
      await adminDb.customerLifecycleState.count({
        where: { organizationId: org.id },
      }),
    ).toBeGreaterThan(0);
    expect(
      await adminDb.lostReason.count({ where: { organizationId: org.id } }),
    ).toBeGreaterThan(0);
    expect(
      await adminDb.service.count({ where: { organizationId: org.id } }),
    ).toBeGreaterThan(0);
  });

  it("keeps Lead Status, Pipeline Stage, and Customer Lifecycle State as three distinct catalogs (AC3)", async () => {
    const org = await createTestOrganization("Separation Check");

    const leadStatusKeys = (
      await adminDb.leadStatus.findMany({ where: { organizationId: org.id } })
    ).map((s) => s.key);
    const pipelineStageKeys = (
      await adminDb.pipelineStage.findMany({
        where: { organizationId: org.id },
      })
    ).map((s) => s.key);
    const lifecycleStateKeys = (
      await adminDb.customerLifecycleState.findMany({
        where: { organizationId: org.id },
      })
    ).map((s) => s.key);

    const overlapWithPipeline = leadStatusKeys.filter((k) =>
      pipelineStageKeys.includes(k),
    );
    const overlapWithLifecycle = leadStatusKeys.filter((k) =>
      lifecycleStateKeys.includes(k),
    );

    expect(overlapWithPipeline).toHaveLength(0);
    expect(overlapWithLifecycle).toHaveLength(0);
    expect(pipelineStageKeys).not.toEqual(lifecycleStateKeys);
  });

  it("is idempotent: seeding organization defaults twice does not duplicate rows", async () => {
    const org = await createTestOrganization("Idempotency Check");
    const before = await adminDb.leadSource.count({
      where: { organizationId: org.id },
    });

    await seedOrganizationDefaults(org.id);
    await seedOrganizationDefaults(org.id);

    const after = await adminDb.leadSource.count({
      where: { organizationId: org.id },
    });
    expect(after).toBe(before);
  });
});
