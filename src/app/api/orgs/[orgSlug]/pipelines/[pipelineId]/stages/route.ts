import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { addPipelineStage } from "@/services/pipelineService";

const AddSchema = z.strictObject({
  name: z.string({ error: "name is required." }),
  probability: z.number().int().nullable().optional(),
  /** Where among the open stages (0 is first); the end when left out. Won and lost stay last. */
  position: z.number().int().optional(),
});

// Adds an open stage to a pipeline (FIG-1147, B6.15; Management).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; pipelineId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, pipelineId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, AddSchema);
    return withIdempotency(ctx, request, body, () => addPipelineStage(ctx, pipelineId, body));
  });
}
