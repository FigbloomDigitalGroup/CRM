import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listNeedsLinking } from "@/services/conversationService";

const QuerySchema = z.object({ q: z.string().optional(), ...pageQueryShape });

// Messages that matched no record. `access` says whether the caller may act or only read (Delivery reads).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    return listNeedsLinking(ctx, { q: query.q }, toPageRequest(query));
  });
}
