import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseOptionalJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { renewRecurringService } from "@/services/recurringServiceService";

const RenewSchema = z.strictObject({
  /** Also create a task for the renewal (needs the task permission). */
  task: z.strictObject({ title: z.string().optional(), dueOn: z.string().optional(), assigneeMembershipId: z.string().optional() }).optional(),
  /** Also create a draft invoice for the new period (needs the payments permission). */
  invoice: z.strictObject({ number: z.string(), amount: z.union([z.number(), z.string()]).optional(), dueOn: z.string().optional() }).optional(),
});

// Renews for the next period; a double tap with the same Idempotency-Key renews once.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; serviceId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, serviceId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = (await parseOptionalJsonBody(request, RenewSchema)) ?? {};
    return withIdempotency(ctx, request, body, () => renewRecurringService(ctx, serviceId, body));
  });
}
