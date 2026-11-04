import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { scheduleDraft, unscheduleDraft } from "@/services/mailService";

type P = { params: Promise<{ orgSlug: string; draftId: string }> };

// Queues the draft to be sent at a time, on the job framework.
export async function POST(request: Request, { params }: P) {
  return handleRoute(async () => {
    const { orgSlug, draftId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, z.strictObject({ sendAt: z.string() }));
    return scheduleDraft(ctx, draftId, new Date(body.sendAt));
  });
}

// Takes a scheduled message back to a draft.
export async function DELETE(_request: Request, { params }: P) {
  return handleRoute(async () => {
    const { orgSlug, draftId } = await params;
    return unscheduleDraft(await resolveRequestContext(orgSlug), draftId);
  });
}
