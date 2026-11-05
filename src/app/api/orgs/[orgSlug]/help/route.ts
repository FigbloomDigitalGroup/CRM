import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listHelpArticles } from "@/services/helpService";

const QuerySchema = z.object({
  q: z.string().optional(),
  area: z.string().optional(),
  /** Also returns the tips for this page (home, leads, deals, tasks, companies, reports, settings). */
  page: z.string().optional(),
});

// The Help article index (design X3, FIG-1149), for the caller's role.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    return listHelpArticles(ctx, query);
  });
}
