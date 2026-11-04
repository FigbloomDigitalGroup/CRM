import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getForecast } from "@/services/forecastService";

const QuerySchema = z.object({
  scope: z.enum(["mine", "team"]).optional(),
  /** YYYY-MM. */
  month: z.string().optional(),
  months: z.coerce.number().optional(),
});

// Forecast and targets (design Q4, FIG-1146): weighted pipeline by month, won so far and where each person stands against their target.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    return getForecast(ctx, { scope: query.scope, month: query.month, months: query.months });
  });
}
