import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listRequests } from "@/services/leadPoolService";

const ListQuerySchema = z.object({ status: z.string().optional(), ...pageQueryShape });

// Requests to take pool leads: Management sees all, a salesperson sees their own.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, ListQuerySchema);
    return listRequests(ctx, { status: query.status }, toPageRequest(query));
  });
}
