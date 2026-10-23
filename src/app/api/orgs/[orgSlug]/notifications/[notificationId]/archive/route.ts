import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { setNotificationArchived } from "@/services/notificationCentreService";

// POST archives a notification, DELETE brings it back (FIG-1040).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; notificationId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, notificationId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return setNotificationArchived(ctx, notificationId, true);
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; notificationId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, notificationId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return setNotificationArchived(ctx, notificationId, false);
  });
}
