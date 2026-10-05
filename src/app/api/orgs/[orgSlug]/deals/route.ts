import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, parseQueryParams, requiredString } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { createDeal, listDeals } from "@/services/dealService";

const OutcomeEnum = z.enum(["OPEN", "WON", "LOST"]);

const ListDealsQuerySchema = z.object({
  q: z.string().optional(),
  ownerMembershipId: z.string().optional(),
  pipelineStageId: z.string().optional(),
  outcome: OutcomeEnum.optional(),
  companyId: z.string().optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
});

const CreateDealSchema = z.object({
  companyId: requiredString("companyId is required."),
  primaryContactId: z.string().optional(),
  serviceId: z.string().optional(),
  ownerMembershipId: z.string().optional(),
  pipelineStageId: requiredString("pipelineStageId is required."),
  value: z.union([z.number(), z.string()]).optional(),
  currency: z.string().optional(),
  // Deliberately a string, not z.coerce.date() -- dealService.createDeal
  // does its own new Date() conversion (a date-only "YYYY-MM-DD" string
  // needs different handling than a full ISO datetime; see its comment).
  expectedCloseDate: z.string().optional(),
  notes: z.string().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    const query = parseQueryParams(searchParams, ListDealsQuerySchema);
    return listDeals(ctx, {
      query: query.q,
      ownerMembershipId: query.ownerMembershipId,
      pipelineStageId: query.pipelineStageId,
      outcome: query.outcome,
      companyId: query.companyId,
      includeArchived: query.includeArchived === "true",
    });
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateDealSchema);
    return createDeal(ctx, body);
  });
}
