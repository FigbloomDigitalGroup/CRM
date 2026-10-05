import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getDeal, updateDeal } from "@/services/dealService";

const UpdateDealSchema = z.object({
  primaryContactId: z.string().nullable().optional(),
  serviceId: z.string().nullable().optional(),
  pipelineStageId: z.string().optional(),
  lostReasonId: z.string().nullable().optional(),
  value: z.union([z.number(), z.string()]).nullable().optional(),
  currency: z.string().optional(),
  expectedCloseDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

type RouteParams = { params: Promise<{ orgSlug: string; dealId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getDeal(ctx, dealId);
  });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateDealSchema);
    return updateDeal(ctx, dealId, body);
  });
}
