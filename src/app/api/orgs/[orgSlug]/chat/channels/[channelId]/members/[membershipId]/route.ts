import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { removeMember } from "@/services/chatService";

export async function DELETE(request: Request, { params }: { params: Promise<{ orgSlug: string; channelId: string; membershipId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, channelId, membershipId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return removeMember(ctx, channelId, membershipId);
  });
}
