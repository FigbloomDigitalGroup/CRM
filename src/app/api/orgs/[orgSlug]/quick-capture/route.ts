import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { quickCapture } from "@/services/quickCaptureService";

const QuickCaptureSchema = z.strictObject({
  name: z.string({ error: "name is required." }),
  phone: z.string().optional(),
  email: z.string().optional(),
  company: z.string().optional(),
  serviceId: z.string().optional(),
  sourceId: z.string().optional(),
  note: z.string().optional(),
  followUp: z.strictObject({ title: z.string(), dueOn: z.string().optional() }).optional(),
  duplicateDecision: z.enum(["OPEN_EXISTING", "CREATE_ANYWAY", "MERGE"]).optional(),
  duplicateId: z.string().optional(),
});

// Capture a lead in seconds (FIG-1065, B4.08, M1). A likely duplicate answers 200 DUPLICATE_WARNING and creates nothing;
// send the same body again with duplicateDecision to open the existing record, create anyway or merge. Idempotency-Key supported.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, QuickCaptureSchema);
    return withIdempotency(ctx, request, body, () => quickCapture(ctx, body));
  });
}
