import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getDealRules, updateDealRules } from "@/services/dealRuleService";

const DealRulesSchema = z.strictObject({
  defaultStalledDays: z.number().int().optional(),
  /** Stage id to days; null uses the default. */
  stages: z.record(z.string(), z.number().int().nullable()).optional(),
});

// Stalled thresholds: an organisation default and an optional number of days per stage (Management).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getDealRules(ctx);
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, DealRulesSchema);
    return updateDealRules(ctx, body);
  });
}
