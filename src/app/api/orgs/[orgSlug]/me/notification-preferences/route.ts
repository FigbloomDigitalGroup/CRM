import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import {
  getMyNotificationPreferencesV2,
  updateMyNotificationPreferencesV2,
} from "@/services/notificationPreferenceService";

const UpdateSchema = z.strictObject({
  preset: z.string().optional(),
  types: z
    .record(
      z.string(),
      z.strictObject({
        inApp: z.boolean().optional(),
        email: z.boolean().optional(),
        push: z.boolean().optional(),
      }),
    )
    .optional(),
  quietHours: z
    .strictObject({
      enabled: z.boolean().optional(),
      start: z.string().optional(),
      end: z.string().optional(),
    })
    .optional(),
  dailyEmailCap: z.number({ error: "The daily email limit must be a number." }).optional(),
});

/** The member's notification preferences: the types that apply to their role, channels, presets, quiet hours and daily limit (B1.11). */
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getMyNotificationPreferencesV2(ctx);
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateSchema);
    return updateMyNotificationPreferencesV2(ctx, body);
  });
}
