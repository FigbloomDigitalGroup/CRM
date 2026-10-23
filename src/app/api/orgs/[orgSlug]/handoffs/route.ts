import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listHandoffs } from "@/services/handoffService";

const ListHandoffsQuerySchema = z.object({
  status: z.string().optional(),
  mine: z.enum(["true", "false"]).optional(),
  ...pageQueryShape,
});

// The Delivery Handoffs view (FIG-1037, B2.08): every handoff with status counts; Awaiting owner is the pool to take from.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, ListHandoffsQuerySchema);
    return listHandoffs(ctx, { ...toPageRequest(query), status: query.status, mine: query.mine === "true" });
  });
}
