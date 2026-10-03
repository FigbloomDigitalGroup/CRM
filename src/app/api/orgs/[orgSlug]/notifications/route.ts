import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import {
  getMyUnreadNotificationCount,
  listMyNotifications,
} from "@/services/notificationService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    const [notifications, unreadCount] = await Promise.all([
      listMyNotifications(ctx, {
        unreadOnly: searchParams.get("unreadOnly") === "true",
      }),
      getMyUnreadNotificationCount(ctx),
    ]);
    return { notifications, unreadCount };
  });
}
