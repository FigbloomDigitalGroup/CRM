import { resolveRequestContext } from "@/auth/requestContext";
import { requireFeature } from "@/services/featureService";

/**
 * Resolves the request context and checks the release or toggle straight
 * away, before any body or query validation and before any record lookup, so
 * an organisation without the feature always gets FEATURE_UNAVAILABLE.
 */
export async function resolveGatedContext(orgSlug: string, featureKey: string) {
  const ctx = await resolveRequestContext(orgSlug);
  await requireFeature(ctx.organizationId, featureKey);
  return ctx;
}
