import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getPaymentAggregates } from "@/services/paymentService";

// The Finance numbers: due this week, overdue, collected this month, still owing (FIG-1050).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getPaymentAggregates(ctx);
  });
}
