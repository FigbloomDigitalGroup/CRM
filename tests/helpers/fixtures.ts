import { randomUUID } from "node:crypto";
import { adminDb } from "../../src/db/adminClient";
import { resolveActiveMembership } from "../../src/repositories/memberships";
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

/**
 * Creates a fresh user + active membership with the given role and returns
 * the resolved `AuthContext` shape the service layer expects -- the
 * standard way service-layer tests get "a user acting as role X in
 * organization Y" without going through any HTTP/session plumbing.
 */
export async function createTestContext(
  organizationId: string,
  roleKey: string,
  userEmailPrefix = "test.ctx",
) {
  const { user } = await createTestMembership(
    organizationId,
    roleKey,
    userEmailPrefix,
  );
  const ctx = await resolveActiveMembership(user.id, organizationId);
  if (!ctx) {
    throw new Error(
      "Expected a resolvable active membership immediately after creating one.",
    );
  }
  return ctx;
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
