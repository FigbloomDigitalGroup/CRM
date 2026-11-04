import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { adminResetMemberTwoStep } from "@/services/twoStepService";

/** Recovery by an administrator (FIG-1134; needs `membership.manage`): removes the member's two-step and ends their sessions. Audited; the member is emailed. */
export async function POST(_request: Request, { params }: { params: Promise<{ orgSlug: string; membershipId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, membershipId } = await params;
    return adminResetMemberTwoStep(await resolveRequestContext(orgSlug), membershipId);
  });
}
