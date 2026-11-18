import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { countUnread } from "@/services/notificationCentreService";

// Cheap badge count for the bell (FIG-1040). Same set as the unread list.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return { unreadCount: await countUnread(ctx) };
  });
}
