import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { rejectDataSubjectRequest } from "@/services/privacyService";

const Schema = z.strictObject({ reason: z.string({ error: "reason is required." }) });

// Reject a request, with the reason for the record.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; requestId: string }> } ,
) {
  return handleRoute(async () => {
    const { orgSlug, requestId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return rejectDataSubjectRequest(ctx, requestId, (await parseJsonBody(request, Schema)).reason);
  });
}
