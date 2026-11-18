import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listEnrollments } from "@/services/followUpService";

const QuerySchema = z.object({
  leadId: z.string().optional(),
  dealId: z.string().optional(),
  sequenceId: z.string().optional(),
  status: z.string().optional(),
  ...pageQueryShape,
});

// Enrolments on a lead or deal the caller may open; without one, all enrolments (cadences.manage).
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    return listEnrollments(ctx, { leadId: query.leadId, dealId: query.dealId, sequenceId: query.sequenceId, status: query.status, paging: toPageRequest(query) });
  });
}
