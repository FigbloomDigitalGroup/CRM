import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { decideExportApproval } from "@/services/privacyService";

const Schema = z.strictObject({ approve: z.boolean({ error: "approve is required." }), note: z.string().optional() });

// Approve or reject a pending export request. Someone other than the requester decides.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; approvalId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, approvalId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return decideExportApproval(ctx, approvalId, await parseJsonBody(request, Schema));
  });
}
