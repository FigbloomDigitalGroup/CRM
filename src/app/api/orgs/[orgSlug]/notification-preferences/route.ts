import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import {
  getMyNotificationPreferences,
  updateMyNotificationPreference,
} from "@/services/notificationService";
import { NOTIFICATION_TYPES, type NotificationTypeKey } from "@/repositories/notificationPreferences";

const UpdateNotificationPreferenceSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES as [NotificationTypeKey, ...NotificationTypeKey[]], {
    message: `type is required and must be one of: ${NOTIFICATION_TYPES.join(", ")}.`,
  }),
  emailEnabled: z.boolean().optional(),
  inAppEnabled: z.boolean().optional(),
});

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
    const body = await parseJsonBody(request, UpdateNotificationPreferenceSchema);
    return updateMyNotificationPreference(ctx, body.type, {
      emailEnabled: body.emailEnabled,
      inAppEnabled: body.inAppEnabled,
    });
  });
}
