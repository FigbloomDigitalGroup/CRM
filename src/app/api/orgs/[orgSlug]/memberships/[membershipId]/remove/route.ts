import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { removeMember } from "@/services/membershipService";

/**
 * Ends a membership (B1.05). 409 `REASSIGNMENT_REQUIRED`, with the checklist
 * of what the member still owns, until everything has been reassigned.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; membershipId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, membershipId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return removeMember(ctx, membershipId);
  });
}
