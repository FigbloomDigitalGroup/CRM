import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listPool } from "@/services/leadPoolService";

const PoolQuerySchema = z.object({ q: z.string().max(100).optional(), ...pageQueryShape });

// The shared pool of unassigned leads (FIG-1031, B2.02). Never includes a lead someone owns.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, PoolQuerySchema);
    return listPool(ctx, { query: query.q }, toPageRequest(query));
  });
}
