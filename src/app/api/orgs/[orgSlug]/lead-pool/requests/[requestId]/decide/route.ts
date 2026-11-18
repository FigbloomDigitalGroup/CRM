import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { decideRequest } from "@/services/leadPoolService";

const DecideSchema = z.strictObject({
  decision: z.enum(["APPROVE", "DECLINE"]),
  /** Required when declining. */
  reason: z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; requestId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, requestId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, DecideSchema);
    return decideRequest(ctx, requestId, body);
  });
}
