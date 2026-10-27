import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { markInvoiceSent } from "@/services/paymentService";

// Draft to sent (FIG-1049). Idempotent: an invoice that is already sent comes back unchanged.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; invoiceId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, invoiceId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return markInvoiceSent(ctx, invoiceId);
  });
}
