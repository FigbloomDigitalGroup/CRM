import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { withIdempotency } from "@/lib/idempotency";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { createDraft, listDrafts } from "@/services/mailService";

const DraftSchema = z.strictObject({
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

// The signed-in person's own drafts, outbox and scheduled sends (FIG-807).
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveGatedContext(orgSlug, "communication.group");
    const query = parseQueryParams(new URL(request.url).searchParams, z.object({ status: z.string().optional() }));
    return listDrafts(ctx, query.status);
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveGatedContext(orgSlug, "communication.group");
    const body = await parseJsonBody(request, DraftSchema);
    return withIdempotency(ctx, request, body, () => createDraft(ctx, body));
  });
}
