import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { linkConversation } from "@/services/conversationService";

const LinkSchema = z.strictObject({
  companyId: z.string().optional(),
  contactId: z.string().optional(),
  leadId: z.string().optional(),
  dealId: z.string().optional(),
});

// Links a waiting message to an existing record. Idempotent: the same record again is a success, a different one is refused.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; conversationId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, conversationId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, LinkSchema);
    return linkConversation(ctx, conversationId, body);
  });
}
