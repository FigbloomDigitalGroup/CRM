import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getAutomationRule, updateAutomationRule } from "@/services/automationService";

const PatchSchema = z.strictObject({
  enabled: z.boolean().optional(),
  params: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  audience: z.enum(["OWNER", "OWNER_AND_MANAGEMENT"]).optional(),
});

type Params = { params: Promise<{ orgSlug: string; ruleKey: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { orgSlug, ruleKey } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getAutomationRule(ctx, ruleKey);
  });
}

// Switch a rule on or off, change its thresholds or its audience. Audited with the before and after.
export async function PATCH(request: Request, { params }: Params) {
  return handleRoute(async () => {
    const { orgSlug, ruleKey } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, PatchSchema);
    return updateAutomationRule(ctx, ruleKey, body);
  });
}
