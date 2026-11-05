import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getWhatsNew } from "@/services/helpService";

const QuerySchema = z.object({
  /** Only notes dated after this day (YYYY-MM-DD). */
  since: z.string().optional(),
  limit: z.coerce.number().optional(),
});

// The release-notes feed (design X3, FIG-1149): notes for the organisation's release, for features the caller's role can use.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    return getWhatsNew(ctx, query);
  });
}
