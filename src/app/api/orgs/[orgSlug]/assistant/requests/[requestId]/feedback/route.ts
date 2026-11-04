import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { recordFeedback } from "@/services/assistantService";

export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string; requestId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, requestId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, z.strictObject({ value: z.enum(["up", "down"]) }));
    return recordFeedback(ctx, requestId, body.value);
  });
}
