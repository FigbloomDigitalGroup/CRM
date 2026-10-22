import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { FeatureSnapshotSchema, UpdateFeaturesBodySchema } from "@/api/dto/features";
import { respond } from "@/api/respond";
import { resolveRequestContext } from "@/auth/requestContext";
import { getFeatureSnapshot, updateFeatureToggles } from "@/services/featureService";

// Release flags and organisation toggles (FIG-1015, B0.07). Any member can
// read them (the navigation needs them); changing a toggle is Management only.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return respond(FeatureSnapshotSchema, await getFeatureSnapshot(ctx));
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateFeaturesBodySchema);
    return respond(FeatureSnapshotSchema, await updateFeatureToggles(ctx, body.toggles));
  });
}
