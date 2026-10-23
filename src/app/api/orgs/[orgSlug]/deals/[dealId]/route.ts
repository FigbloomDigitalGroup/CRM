import { loadStageRules } from "@/services/dealRuleService";
import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { DealSchema, toDealDto } from "@/api/dto/deals";
import { respond } from "@/api/respond";
import { getDeal, updateDeal } from "@/services/dealService";

const UpdateDealSchema = z.object({
  /** Organisation-defined custom field values (FIG-803); a field sent as null is cleared. */
  customFields: z.record(z.string(), z.any()).optional(),
  primaryContactId: z.string().nullable().optional(),
  serviceId: z.string().nullable().optional(),
  pipelineStageId: z.string().optional(),
  lostReasonId: z.string().nullable().optional(),
  value: z.union([z.number(), z.string()]).nullable().optional(),
  currency: z.string().optional(),
  expectedCloseDate: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  // Used only when this update moves the deal to a won stage (FIG-792).
  handoff: z
    .object({
      deliveryOwnerMembershipId: z.string().optional(),
      /** "Owner later": nobody yet; Delivery takes it from the pool. */
      ownerLater: z.boolean().optional(),
      /** Do not create the onboarding tasks. */
      templateOff: z.boolean().optional(),
      /** Do not change the company lifecycle state. */
      lifecycleOff: z.boolean().optional(),
      startDate: z.string().nullable().optional(),
      scope: z.string().nullable().optional(),
      requirements: z.string().nullable().optional(),
      deliverables: z.array(z.string()).optional(),
      teamMembershipIds: z.array(z.string()).optional(),
    })
    .optional(),
});

type RouteParams = { params: Promise<{ orgSlug: string; dealId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return respond(DealSchema, toDealDto(ctx, await getDeal(ctx, dealId), await loadStageRules(ctx.organizationId)));
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
