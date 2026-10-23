import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getQualification, updateQualification } from "@/services/qualificationService";

const UpdateQualificationSchema = z.strictObject({
  /** Answers by question key; null clears one. Only questions that apply to the lead service are accepted. */
  answers: z.record(z.string(), z.unknown()),
});

// The qualification questions for a lead service, its answers, and the progress strip state (FIG-1030, B2.01).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; leadId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, leadId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getQualification(ctx, leadId);
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; leadId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, leadId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UpdateQualificationSchema);
    return updateQualification(ctx, leadId, body.answers);
  });
}
