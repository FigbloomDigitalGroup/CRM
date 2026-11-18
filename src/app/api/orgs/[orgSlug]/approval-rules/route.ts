import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getApprovalRules, updateApprovalRules } from "@/services/approvalService";

const RulesSchema = z.strictObject({
  discount: z.strictObject({ enabled: z.boolean().optional(), thresholdPercent: z.number().optional() }).optional(),
  /** The export threshold is kept with the export rights (B4.05); changing it here changes it there. */
  export: z.strictObject({ thresholdRows: z.number().int().optional() }).optional(),
  largeDeal: z.strictObject({ enabled: z.boolean().optional(), thresholdAmount: z.number().optional(), currency: z.string().optional() }).optional(),
  /** Permanent deletion always needs a second person: false is refused. */
  deletion: z.strictObject({ enabled: z.boolean().optional() }).optional(),
});

// The approval rules (FIG-1145, B6.13; Management writes): what waits for an approver. A rule never approves anything.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getApprovalRules(ctx);
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return updateApprovalRules(ctx, await parseJsonBody(request, RulesSchema));
  });
}
