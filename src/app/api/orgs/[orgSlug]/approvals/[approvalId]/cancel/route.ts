import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { cancelApproval } from "@/services/approvalService";

// The requester withdraws a waiting request (FIG-1145, B6.13).
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; approvalId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, approvalId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return cancelApproval(ctx, approvalId);
  });
}
