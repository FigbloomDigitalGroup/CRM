import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getMemberReassignmentChecklist } from "@/services/reassignmentService";

/** What a member still owns -- the checklist shown before deactivating or removing them (B1.05). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; membershipId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, membershipId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getMemberReassignmentChecklist(ctx, membershipId);
  });
}
