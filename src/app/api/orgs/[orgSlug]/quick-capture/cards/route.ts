import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { withIdempotency } from "@/lib/idempotency";
import { resolveRequestContext } from "@/auth/requestContext";
import { startCardCapture } from "@/services/cardCaptureService";

const StartSchema = z.strictObject({
  name: z.string().min(1).max(200),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  checksumSha256: z.string().optional(),
});

// Begins a business-card capture (FIG-1154): declares the photo and returns the signed upload link.
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, StartSchema);
    return withIdempotency(ctx, request, body, () => startCardCapture(ctx, body));
  });
}
