import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getScoringWeights, updateScoringWeights } from "@/services/scoreService";

const WeightsSchema = z.strictObject({
  lead: z.record(z.string(), z.number()).optional(),
  health: z.record(z.string(), z.number()).optional(),
});

// Management scales each factor group (0 off, 1 default, up to 3); see docs/SCORING.md.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getScoringWeights(ctx);
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, WeightsSchema);
    return updateScoringWeights(ctx, body);
  });
}
