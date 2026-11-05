import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { resolveMemberUserContext } from "@/auth/requestContext";
import { switchOrganization } from "@/services/organizationSwitcherService";

const Schema = z.object({ organizationSlug: requiredString("Choose an organisation.") });

/**
 * Switch the organisation this session has open (FIG-1133). The answer is the new organisation's whole context (same shape as GET /api/me/context):
 * role, permissions, look, preferences, features. A slug the person is not an active member of is a 404, the same as an unknown one.
 */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const { userId, session } = await resolveMemberUserContext();
    const body = await parseJsonBody(request, Schema);
    return switchOrganization({ userId, session, orgSlug: body.organizationSlug });
  });
}
