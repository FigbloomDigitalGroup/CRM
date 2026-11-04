import { handleRoute } from "@/app/api/_lib/handleRoute";
import { withIdempotency } from "@/lib/idempotency";
import { resolveRequestContext } from "@/auth/requestContext";
import { sendDraft } from "@/services/mailService";

// Sends a draft through the connected mailbox. With an Idempotency-Key, a repeated request returns the first answer.
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string; draftId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, draftId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return withIdempotency(ctx, request, { draftId }, () => sendDraft(ctx, draftId));
  });
}
