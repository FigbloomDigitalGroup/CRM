import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getCustomerReport } from "@/services/customerReportService";

// Active, repeat and dormant customers (FIG-793, feeds B3.09).
const QuerySchema = z.object({
  dormantAfterDays: z.string().regex(/^\d+$/, "dormantAfterDays must be a whole number.").optional(),
  segment: z.enum(["active", "repeat", "dormant"]).optional(),
  ...pageQueryShape,
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    return getCustomerReport(
      ctx,
      {
        dormantAfterDays: query.dormantAfterDays ? Number(query.dormantAfterDays) : undefined,
        segment: query.segment,
      },
      toPageRequest(query),
    );
  });
}
