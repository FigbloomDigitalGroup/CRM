import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { changeMemberRole } from "@/services/membershipService";

const ChangeRoleSchema = z.object({
  roleKey: requiredString("roleKey is required."),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; membershipId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, membershipId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, ChangeRoleSchema);
    return changeMemberRole(ctx, membershipId, body.roleKey);
  });
}
