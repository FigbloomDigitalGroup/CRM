import { handleRoute } from "@/app/api/_lib/handleRoute";
import { ValidationError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { changeMemberRole } from "@/services/membershipService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; membershipId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, membershipId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = (await request.json()) as { roleKey?: string };
    if (!body.roleKey) {
      throw new ValidationError("roleKey is required.");
    }
    return changeMemberRole(ctx, membershipId, body.roleKey);
  });
}
