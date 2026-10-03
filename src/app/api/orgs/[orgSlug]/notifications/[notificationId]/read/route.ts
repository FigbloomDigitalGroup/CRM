import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { markNotificationRead } from "@/services/notificationService";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; notificationId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, notificationId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return markNotificationRead(ctx, notificationId);
  });
}
