import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { createPipeline, listPipelines } from "@/services/pipelineService";

const StageSchema = z.strictObject({
  name: z.string({ error: "name is required." }),
  probability: z.number().int().nullable().optional(),
  /** OPEN (default), WON or LOST. A pipeline needs at least one open, exactly one won and exactly one lost stage. */
  kind: z.enum(["OPEN", "WON", "LOST"]).optional(),
});

const CreateSchema = z.strictObject({
  name: z.string({ error: "name is required." }),
  stages: z.array(StageSchema),
  serviceIds: z.array(z.string()).optional(),
});

// Pipelines with their stages, rules and services (FIG-1147, B6.15, V1.1). Anyone who works deals reads; Management writes.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return listPipelines(ctx);
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, CreateSchema);
    return withIdempotency(ctx, request, body, () => createPipeline(ctx, body));
  });
}
