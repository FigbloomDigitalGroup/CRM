import { randomUUID } from "node:crypto";
import { adminDb } from "../../src/db/adminClient";
import { seedOrganizationDefaults } from "../../src/services/organizationDefaults";

/**
 * Every test gets its own uniquely-slugged organization rather than sharing
 * fixtures across tests, so test files can run without needing to reset the
 * database between individual tests.
 */
export async function createTestOrganization(namePrefix = "Test Org") {
  const suffix = randomUUID().slice(0, 8);
  const organization = await adminDb.organization.create({
    data: { name: `${namePrefix} ${suffix}`, slug: `test-org-${suffix}` },
  });
  await seedOrganizationDefaults(organization.id);
  return organization;
}

export async function createTestUser(emailPrefix = "test.user") {
  const suffix = randomUUID().slice(0, 8);
  return adminDb.user.create({
    data: { email: `${emailPrefix}.${suffix}@example.test`, name: "Test User" },
  });
}

export async function createTestMembership(
  organizationId: string,
  roleKey: string,
  userEmailPrefix = "test.member",
) {
  const user = await createTestUser(userEmailPrefix);
  const role = await adminDb.role.findUniqueOrThrow({
    where: { key: roleKey },
  });
  const membership = await adminDb.membership.create({
    data: {
      organizationId,
      userId: user.id,
      roleId: role.id,
      joinedAt: new Date(),
    },
  });
  return { user, membership };
}

export async function getLeadStatusId(organizationId: string, key = "NEW") {
  const status = await adminDb.leadStatus.findFirstOrThrow({
    where: { organizationId, key },
  });
  return status.id;
}

export async function getPipelineStageId(
  organizationId: string,
  key = "SOLUTION_PRESENTED",
) {
  const stage = await adminDb.pipelineStage.findFirstOrThrow({
    where: { organizationId, key },
  });
  return stage.id;
}

export async function getLostReasonId(
  organizationId: string,
  key = "NO_RESPONSE",
) {
  const reason = await adminDb.lostReason.findFirstOrThrow({
    where: { organizationId, key },
  });
  return reason.id;
}
