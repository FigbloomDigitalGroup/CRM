import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { recordPayment } from "@/services/paymentService";

const RecordPaymentSchema = z.strictObject({
  amount: z.union([z.number(), z.string()], { error: "amount is required." }),
  paidOn: z.string().optional(),
  methodLabel: z.string().optional(),
  reference: z.string().optional(),
  /** Accept a payment above what is owing; the invoice remembers it. */
  allowOverpayment: z.boolean().optional(),
});

// Records money received against an invoice (status only; nothing is processed). A retry with the same Idempotency-Key records it once.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; invoiceId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, invoiceId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, RecordPaymentSchema);
    return withIdempotency(ctx, request, body, () => recordPayment(ctx, invoiceId, body));
  });
}
