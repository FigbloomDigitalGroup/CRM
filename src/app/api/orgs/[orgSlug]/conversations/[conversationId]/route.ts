import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getConversation } from "@/services/conversationService";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; conversationId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, conversationId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getConversation(ctx, conversationId);
  });
}
