import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { discardCardCapture, getCardCapture } from "@/services/cardCaptureService";

type P = { params: Promise<{ orgSlug: string; captureId: string }> };

export async function GET(_request: Request, { params }: P) {
  return handleRoute(async () => {
    const { orgSlug, captureId } = await params;
    return getCardCapture(await resolveGatedContext(orgSlug, "release.v11"), captureId);
  });
}

// The person does not want to keep the card.
export async function DELETE(_request: Request, { params }: P) {
  return handleRoute(async () => {
    const { orgSlug, captureId } = await params;
    return discardCardCapture(await resolveGatedContext(orgSlug, "release.v11"), captureId);
  });
}
