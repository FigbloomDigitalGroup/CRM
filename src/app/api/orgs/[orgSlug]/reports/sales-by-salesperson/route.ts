import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getSalesBySalesperson } from "@/services/customerReportService";

// Won value and count by salesperson, total or by month (FIG-793, feeds B3.09).
const QuerySchema = z.object({
  ownerMembershipId: z.string().optional(),
  serviceId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  period: z.enum(["total", "month"]).optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    return getSalesBySalesperson(ctx, query);
  });
}
