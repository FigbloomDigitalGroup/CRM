import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { dismissConversation } from "@/services/conversationService";

const DismissSchema = z.strictObject({ reason: z.string({ error: "reason is required." }) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; conversationId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, conversationId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, DismissSchema);
    return dismissConversation(ctx, conversationId, body);
  });
}
