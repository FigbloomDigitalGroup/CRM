import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { ValidationError } from "@/auth/errors";
import {
  getMyNotificationPreferences,
  updateMyNotificationPreference,
} from "@/services/notificationService";
import { NOTIFICATION_TYPES } from "@/repositories/notificationPreferences";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getMyNotificationPreferences(ctx);
  });
}

/** Self-service -- always the caller's own preferences, never another membership's; no permission check beyond being an active member. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = (await request.json()) as {
      type?: string;
      emailEnabled?: boolean;
      inAppEnabled?: boolean;
    };
    if (!body.type || !NOTIFICATION_TYPES.includes(body.type as never)) {
      throw new ValidationError(
        `type is required and must be one of: ${NOTIFICATION_TYPES.join(", ")}.`,
      );
    }
    return updateMyNotificationPreference(ctx, body.type as never, {
      emailEnabled: body.emailEnabled,
      inAppEnabled: body.inAppEnabled,
    });
  });
}
