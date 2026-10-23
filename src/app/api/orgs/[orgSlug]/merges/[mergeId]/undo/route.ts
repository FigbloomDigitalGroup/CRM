import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { undoMerge } from "@/services/mergeService";

// Reverses a company or contact merge within the undo window (FIG-1033, B2.04).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; mergeId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, mergeId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return undoMerge(ctx, mergeId);
  });
}
