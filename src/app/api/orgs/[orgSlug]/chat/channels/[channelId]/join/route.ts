import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { joinChannel } from "@/services/chatService";

export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string; channelId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, channelId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return joinChannel(ctx, channelId);
  });
}
