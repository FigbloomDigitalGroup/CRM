import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseOptionalJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { createLeadFromConversation } from "@/services/conversationService";

const CreateLeadSchema = z.strictObject({
  companyId: z.string().optional(),
  serviceInterestId: z.string().optional(),
  leadStatusId: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  /** Create the lead although the duplicate check found matching records. */
  confirmDuplicate: z.boolean().optional(),
});

// Turns a waiting message into a lead. The first call may answer `duplicateWarning: true` with the matches; send `confirmDuplicate` to go ahead.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; conversationId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, conversationId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseOptionalJsonBody(request, CreateLeadSchema);
    return createLeadFromConversation(ctx, conversationId, body);
  });
}
