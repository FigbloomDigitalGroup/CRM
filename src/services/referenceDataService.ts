import type { AuthContext } from "../auth/context";
import { hasPermission } from "../auth/context";
import { adminDb } from "../db/adminClient";
import { listOrganizationMemberships } from "../repositories/memberships";

/**
 * Read-only catalogs/pickers for building the CRM forms/screens. Every
 * active member can see the controlled-value catalogs (they need the
 * labels to read or fill in a record regardless of edit rights); the
 * member list is additionally gated behind `membership.view` since it
 * reveals who else is in the organization.
 */
export async function getFormReferenceData(ctx: AuthContext) {
  const organizationId = ctx.organizationId;

  const [
    leadSources,
    leadStatuses,
    pipelineStages,
    lifecycleStates,
    lostReasons,
    services,
  ] = await Promise.all([
    adminDb.leadSource.findMany({
      where: { organizationId, isActive: true },
      orderBy: { sequence: "asc" },
    }),
    adminDb.leadStatus.findMany({
      where: { organizationId, isActive: true },
      orderBy: { sequence: "asc" },
    }),
    adminDb.pipelineStage.findMany({
      where: { organizationId, isActive: true },
      orderBy: { sequence: "asc" },
    }),
    adminDb.customerLifecycleState.findMany({
      where: { organizationId, isActive: true },
      orderBy: { sequence: "asc" },
    }),
    adminDb.lostReason.findMany({
      where: { organizationId, isActive: true },
      orderBy: { sequence: "asc" },
    }),
    adminDb.service.findMany({
      where: { organizationId, isActive: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const members = hasPermission(ctx, "membership.view")
    ? await listOrganizationMemberships(organizationId)
    : [];

  return {
    leadSources,
    leadStatuses,
    pipelineStages,
    lifecycleStates,
    lostReasons,
    services,
    members,
  };
}
