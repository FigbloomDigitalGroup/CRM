import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { cancelRecurringService } from "@/services/recurringServiceService";

const CancelSchema = z.strictObject({ reason: z.string({ error: "reason is required." }) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; serviceId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, serviceId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CancelSchema);
    return cancelRecurringService(ctx, serviceId, body);
  });
}
