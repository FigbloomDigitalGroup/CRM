import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { resendInvite } from "@/services/membershipService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; membershipId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, membershipId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const origin = new URL(request.url).origin;
    await resendInvite(
      ctx,
      membershipId,
      (token) => `${origin}/accept-invite?token=${token}`,
    );
    return { ok: true };
  });
}
