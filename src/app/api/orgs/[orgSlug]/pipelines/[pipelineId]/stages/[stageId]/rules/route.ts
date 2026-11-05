import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { setStageRules } from "@/services/pipelineService";

const RulesSchema = z.strictObject({
  rules: z.array(
    z.strictObject({
      /** QUOTE_REQUIRED, REQUIRED_FIELDS or APPROVAL_REQUIRED. */
      type: z.string({ error: "type is required." }),
      enabled: z.boolean().optional(),
      /** For REQUIRED_FIELDS: value, expectedCloseDate, primaryContactId, serviceId, notes or custom:<key>. */
      fields: z.array(z.string()).optional(),
    }),
  ),
});

// Replaces the rules on a stage (FIG-1147, B6.15; Management). The response says in words what the change will do. A rule
// blocks a move into the stage and explains why; it never moves a deal or approves anything.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; pipelineId: string; stageId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, pipelineId, stageId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return setStageRules(ctx, pipelineId, stageId, (await parseJsonBody(request, RulesSchema)).rules);
  });
}
