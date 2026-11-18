import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { listExportApprovals, requestExportApproval } from "@/services/privacyService";

const Create = z.strictObject({ entity: z.string({ error: "entity is required." }), filters: z.record(z.string(), z.unknown()).optional(), reason: z.string().optional() });
const List = z.object({ status: z.string().optional(), ...pageQueryShape });

// Ask Management to approve one bulk export above the row threshold; list requests (Management sees all, others their own).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> } ,
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, List);
    return listExportApprovals(ctx, { status: query.status, paging: toPageRequest(query) });
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> } ,
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, Create);
    return withIdempotency(ctx, request, body, () => requestExportApproval(ctx, body));
  });
}
