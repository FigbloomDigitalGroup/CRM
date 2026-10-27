import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getReminderSettings, updateReminderSettings } from "@/services/reminderService";

const UpdateSchema = z.strictObject({
  proposalFollowUp: z.strictObject({ enabled: z.boolean().optional(), days: z.number().optional() }).optional(),
  renewal: z.strictObject({ enabled: z.boolean().optional(), daysAhead: z.number().optional() }).optional(),
  dormant: z.strictObject({ enabled: z.boolean().optional() }).optional(),
  overdueInvoices: z.strictObject({ enabled: z.boolean().optional() }).optional(),
});

// Automatic reminders: each rule can be switched off and has its own threshold (FIG-795). They only ever tell a person.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getReminderSettings(ctx);
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateSchema);
    return updateReminderSettings(ctx, body);
  });
}
