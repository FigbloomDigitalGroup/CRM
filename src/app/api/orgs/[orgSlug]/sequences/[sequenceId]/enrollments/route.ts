import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { enrol } from "@/services/followUpService";

const EnrolSchema = z.strictObject({ leadId: z.string().optional(), dealId: z.string().optional() });

// Enrols a lead or deal the caller may open in this sequence.
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string; sequenceId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, sequenceId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, EnrolSchema);
    return withIdempotency(ctx, request, body, () => enrol(ctx, sequenceId, body));
  });
}
