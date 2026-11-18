import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { reorderPipelineStages } from "@/services/pipelineService";

const ReorderSchema = z.strictObject({
  /** Every open stage of the pipeline, once, in the new order. Won and lost stay last. */
  stageIds: z.array(z.string()),
});

// Reorders the open stages of a pipeline (FIG-1147, B6.15; Management).
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; pipelineId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, pipelineId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return reorderPipelineStages(ctx, pipelineId, (await parseJsonBody(request, ReorderSchema)).stageIds);
  });
}
