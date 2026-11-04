import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { deleteDraft, getDraft, updateDraft } from "@/services/mailService";

const UpdateSchema = z.strictObject({
  to: z.array(z.string()).max(40).optional(),
  cc: z.array(z.string()).max(40).optional(),
  subject: z.string().max(300).optional(),
  body: z.string().max(100000).optional(),
  replyToCommunicationId: z.string().optional(),
  attachmentIds: z.array(z.string()).max(10).optional(),
  companyId: z.string().optional(),
  contactId: z.string().optional(),
  leadId: z.string().optional(),
  dealId: z.string().optional(),
});

type P = { params: Promise<{ orgSlug: string; draftId: string }> };

export async function GET(_request: Request, { params }: P) {
  return handleRoute(async () => {
    const { orgSlug, draftId } = await params;
    return getDraft(await resolveRequestContext(orgSlug), draftId);
  });
}

export async function PATCH(request: Request, { params }: P) {
  return handleRoute(async () => {
    const { orgSlug, draftId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return updateDraft(ctx, draftId, await parseJsonBody(request, UpdateSchema));
  });
}

export async function DELETE(_request: Request, { params }: P) {
  return handleRoute(async () => {
    const { orgSlug, draftId } = await params;
    return deleteDraft(await resolveRequestContext(orgSlug), draftId);
  });
}
