import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { countFieldUsage } from "@/services/customFieldService";

// How many records hold a value for this field: shown before retiring it.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; fieldId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, fieldId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return countFieldUsage(ctx, fieldId);
  });
}
