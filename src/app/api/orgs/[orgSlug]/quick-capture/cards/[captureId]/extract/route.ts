import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { extractCard } from "@/services/cardCaptureService";

// After the upload: checks and reads the card and returns the SUGGESTED fields to confirm. Creates nothing.
export async function POST(_request: Request, { params }: { params: Promise<{ orgSlug: string; captureId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, captureId } = await params;
    return extractCard(await resolveRequestContext(orgSlug), captureId);
  });
}
