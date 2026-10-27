import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { listAllMembershipsForAdmin } from "../repositories/memberships";
import { getOrganizationProfile } from "./organizationProfileService";
import { listIntegrations } from "./integrationRegistryService";

/**
 * What the Settings landing page needs in one call (FIG-1058, B4.01, screen S1): the organisation
 * profile, how many members are in each state, and the state of every integration. Management only.
 * Integration details are read behind `configuration.manage` and are left out of the answer, with
 * a reason, for anyone who holds only `organization.manage_settings`.
 */
export async function getSettingsOverview(ctx: AuthContext) {
  requirePermission(ctx, "organization.manage_settings");
  const [profile, members] = await Promise.all([
    getOrganizationProfile(ctx),
    listAllMembershipsForAdmin(ctx.organizationId),
  ]);

  const memberCounts = { invited: 0, active: 0, deactivated: 0, removed: 0 };
  let invitesExpired = 0;
  let locked = 0;
  for (const m of members) {
    memberCounts[m.state] += 1;
    if (m.inviteExpired) invitesExpired += 1;
    if (m.lockedUntil) locked += 1;
  }

  const integrations = hasPermission(ctx, "configuration.manage")
    ? await listIntegrations(ctx)
    : {
        status: "no_access" as const,
        reason: "Integration details are for Management.",
        requires: ["configuration.manage"],
      };

  return {
    profile,
    members: { counts: memberCounts, invitesExpired, locked, total: members.length },
    integrations,
  };
}
