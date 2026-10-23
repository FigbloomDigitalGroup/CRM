import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import {
  getHandoffSettings,
  updateHandoffSettings,
} from "@/services/handoffService";

// The onboarding task template and customer state used when a deal is won
// (FIG-792). The Settings screen for this is built in the frontend makeover.
const UpdateHandoffSettingsSchema = z.object({
  tasks: z.array(
    z.object({
      title: z.string(),
      description: z.string().optional(),
      dueInDays: z.number(),
      priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
    }),
  ),
  customerLifecycleStateId: z.string().nullable().optional(),
  /** Whether Management may mark a handoff Delivered, or only its Delivery owner (default true). */
  managementCanMarkDelivered: z.boolean().optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getHandoffSettings(ctx);
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateHandoffSettingsSchema);
    return updateHandoffSettings(ctx, {
      tasks: body.tasks,
      customerLifecycleStateId: body.customerLifecycleStateId ?? null,
    });
  });
}
