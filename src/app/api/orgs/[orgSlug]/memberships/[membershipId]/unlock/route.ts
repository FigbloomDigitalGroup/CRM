import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { unlockMember } from "@/services/membershipService";

/** Lifts an account lockout straight away (B1.05; needs `security.manage`). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; membershipId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, membershipId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return unlockMember(ctx, membershipId);
  });
}
