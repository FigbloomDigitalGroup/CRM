import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { withIdempotency } from "@/lib/idempotency";
import { resolveRequestContext } from "@/auth/requestContext";
import { confirmCardCapture } from "@/services/cardCaptureService";

const ConfirmSchema = z.strictObject({
  confirmed: z.boolean(),
  fields: z.strictObject({
    name: z.string().max(200),
    company: z.string().max(200).optional(),
    title: z.string().max(200).optional(),
    phone: z.string().max(40).optional(),
    email: z.string().max(200).optional(),
    website: z.string().max(200).optional(),
    note: z.string().max(1000).optional(),
  }),
  duplicateDecision: z.enum(["OPEN_EXISTING", "CREATE_ANYWAY", "MERGE"]).optional(),
  duplicateId: z.string().optional(),
  serviceId: z.string().optional(),
  sourceId: z.string().optional(),
});

// The person's explicit confirmation of every field: only now does a lead exist, and the photo is attached to it.
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string; captureId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, captureId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, ConfirmSchema);
    return withIdempotency(ctx, request, { captureId, body }, () => confirmCardCapture(ctx, captureId, body));
  });
}
