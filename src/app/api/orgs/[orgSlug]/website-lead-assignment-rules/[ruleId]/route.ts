import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString, validateData } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import {
  setAssignmentRuleActive,
  updateAssignmentRule,
} from "@/services/websiteLeadAssignmentRuleService";

const ToggleActiveSchema = z.object({ isActive: z.boolean() });

const UpdateRuleSchema = z.object({
  name: requiredString("name is required."),
  leadSourceId: z.string().nullable().optional(),
  serviceId: z.string().nullable().optional(),
  assigneeMembershipId: z.string().nullable().optional(),
  assigneeMembershipIds: z.array(z.string()).optional(),
});

/**
 * One endpoint for both "edit" and "enable/disable", same shape as
 * `reference-catalogs/[catalogKey]/[entryId]/route.ts` -- parsed generically
 * first, then validated a second time against whichever schema the raw
 * body's shape fits.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; ruleId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, ruleId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const raw = await parseJsonBody(request, z.record(z.string(), z.unknown()));

    if (typeof raw.isActive === "boolean" && Object.keys(raw).length === 1) {
      const { isActive } = validateData(raw, ToggleActiveSchema);
      return setAssignmentRuleActive(ctx, ruleId, isActive);
    }
    const body = validateData(raw, UpdateRuleSchema);
    return updateAssignmentRule(ctx, ruleId, body);
  });
}
