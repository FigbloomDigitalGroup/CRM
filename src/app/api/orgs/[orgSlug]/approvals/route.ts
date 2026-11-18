import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listApprovals } from "@/services/approvalService";

const ListQuerySchema = z.object({
  /** PENDING, APPROVED, REJECTED, CANCELLED or EXPIRED. */
  status: z.string().optional(),
  /** DISCOUNT, EXPORT, DELETION or LARGE_DEAL. */
  kind: z.string().optional(),
  /** Only my own requests (approvers see everything by default). */
  mine: z.enum(["true", "false"]).optional(),
  ...pageQueryShape,
});

// The approvals inbox (FIG-1145, B6.13, V1.1). Approvers see what waits for them; everyone else sees only their own requests,
// with the reason when one was rejected. Export approvals and erasure confirmations appear here too.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, ListQuerySchema);
    return listApprovals(ctx, { status: query.status, kind: query.kind, mine: query.mine === "true" }, toPageRequest(query));
  });
}
