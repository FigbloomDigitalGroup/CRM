import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { setTyping } from "@/services/chatRealtimeService";

// "Is typing", for six seconds.
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string; channelId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, channelId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return setTyping(ctx, channelId);
  });
}
