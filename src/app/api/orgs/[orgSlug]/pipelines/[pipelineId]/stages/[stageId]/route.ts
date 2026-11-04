import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { updatePipelineStage } from "@/services/pipelineService";

const UpdateSchema = z.strictObject({
  name: z.string().optional(),
  probability: z.number().int().nullable().optional(),
  stalledAfterDays: z.number().int().nullable().optional(),
  /** false is refused while open deals are in the stage, and for a won or lost stage. */
  isActive: z.boolean().optional(),
});

// Edits a stage (FIG-1147, B6.15; Management). Stages are switched off, never deleted.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; pipelineId: string; stageId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, pipelineId, stageId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return updatePipelineStage(ctx, pipelineId, stageId, await parseJsonBody(request, UpdateSchema));
  });
}
