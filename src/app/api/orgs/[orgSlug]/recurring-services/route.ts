import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { createRecurringService, listRecurringServices } from "@/services/recurringServiceService";

const ListQuerySchema = z.object({
  companyId: z.string().optional(),
  /** ACTIVE, DUE_SOON, LAPSED, STARTS_LATER or CANCELLED. */
  state: z.string().optional(),
  ownerMembershipId: z.string().optional(),
  serviceId: z.string().optional(),
  ...pageQueryShape,
});

const CreateSchema = z.strictObject({
  companyId: z.string({ error: "companyId is required." }),
  serviceId: z.string({ error: "serviceId is required." }),
  billingCycle: z.enum(["MONTHLY", "QUARTERLY", "YEARLY"]).optional(),
  value: z.union([z.number(), z.string()]).nullable().optional(),
  currency: z.string().optional(),
  startsOn: z.string({ error: "startsOn is required." }),
  renewsOn: z.string({ error: "renewsOn is required." }),
  ownerMembershipId: z.string().nullable().optional(),
  autoRenew: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});

// Recurring services and their renewal state (FIG-1051). The value is masked like a deal's.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, ListQuerySchema);
    return listRecurringServices(ctx, { companyId: query.companyId, state: query.state, ownerMembershipId: query.ownerMembershipId, serviceId: query.serviceId }, toPageRequest(query));
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateSchema);
    return withIdempotency(ctx, request, body, () => createRecurringService(ctx, body));
  });
}
