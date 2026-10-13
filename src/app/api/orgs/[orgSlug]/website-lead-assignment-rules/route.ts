import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import {
  createAssignmentRule,
  listAssignmentRules,
} from "@/services/websiteLeadAssignmentRuleService";

const RuleInputSchema = z.object({
  name: requiredString("name is required."),
  leadSourceId: z.string().nullable().optional(),
  serviceId: z.string().nullable().optional(),
  assigneeMembershipId: z.string().nullable().optional(),
  assigneeMembershipIds: z.array(z.string()).optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return listAssignmentRules(ctx);
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, RuleInputSchema);
    return createAssignmentRule(ctx, body);
  });
}
