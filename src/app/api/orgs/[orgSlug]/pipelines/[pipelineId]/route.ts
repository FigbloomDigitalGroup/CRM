import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getPipelineDetail, updatePipeline } from "@/services/pipelineService";

const UpdateSchema = z.strictObject({
  name: z.string().optional(),
  /** false is refused for the default pipeline and while open deals are in it. */
  isActive: z.boolean().optional(),
  /** true makes this the default pipeline. */
  isDefault: z.boolean().optional(),
  /** Replaces the services this pipeline is used for. */
  serviceIds: z.array(z.string()).optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; pipelineId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, pipelineId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getPipelineDetail(ctx, pipelineId);
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; pipelineId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, pipelineId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return updatePipeline(ctx, pipelineId, await parseJsonBody(request, UpdateSchema));
  });
}
