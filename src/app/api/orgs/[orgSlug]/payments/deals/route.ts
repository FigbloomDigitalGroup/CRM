import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listWonDealPayments } from "@/services/paymentService";

const QuerySchema = z.object({ companyId: z.string().optional(), ...pageQueryShape });

// Won deals with what has been invoiced and received and the next follow-up note: the tracker's "by deal" view (FIG-1050).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    return listWonDealPayments(ctx, { ...toPageRequest(query), companyId: query.companyId });
  });
}
