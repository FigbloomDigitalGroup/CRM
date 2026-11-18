import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveMemberUserContext } from "@/auth/requestContext";
import { listMyOrganizations } from "@/services/organizationSwitcherService";

/** The organisations the person is an active member of, with their role in each and which one is open now (FIG-1133, TB4). Only their own memberships. */
export async function GET() {
  return handleRoute(async () => {
    const { userId, session } = await resolveMemberUserContext();
    return listMyOrganizations(userId, session?.organizationId ?? null);
  });
}
