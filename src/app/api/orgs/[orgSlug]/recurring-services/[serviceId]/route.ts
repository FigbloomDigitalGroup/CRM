import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getRecurringService, updateRecurringService } from "@/services/recurringServiceService";

const UpdateSchema = z.strictObject({
  billingCycle: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]).optional(),
  value: z.union([z.number(), z.string()]).nullable().optional(),
  startsOn: z.string().optional(),
  renewsOn: z.string().optional(),
  ownerMembershipId: z.string().nullable().optional(),
  autoRenew: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; serviceId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, serviceId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getRecurringService(ctx, serviceId);
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; serviceId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, serviceId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateSchema);
    return updateRecurringService(ctx, serviceId, body);
  });
}
