import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getApproval } from "@/services/approvalService";

// One approval request (FIG-1145, B6.13). Anyone but an approver gets 404 for a request that is not their own.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; approvalId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, approvalId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getApproval(ctx, approvalId);
  });
}
