import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getUnreadTotals } from "@/services/chatService";

// What the sidebar badge shows: unread messages and mentions across the channels the person is in.
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getUnreadTotals(ctx);
  });
}
