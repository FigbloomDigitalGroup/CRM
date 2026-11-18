import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { reversePayment } from "@/services/paymentService";

const ReverseSchema = z.strictObject({ reason: z.string({ error: "reason is required." }) });

// A payment recorded by mistake is reversed with a reason; the record stays (FIG-1049).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; paymentId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, paymentId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, ReverseSchema);
    return reversePayment(ctx, paymentId, body);
  });
}
