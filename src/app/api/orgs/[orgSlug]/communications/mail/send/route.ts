import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { withIdempotency } from "@/lib/idempotency";
import { resolveRequestContext } from "@/auth/requestContext";
import { sendMail } from "@/services/mailService";

const SendSchema = z.strictObject({
  to: z.array(z.string()).min(1).max(40),
  cc: z.array(z.string()).max(40).optional(),
  subject: z.string().min(1).max(300),
  body: z.string().max(100000),
  /** Reply: the logged message being answered. */
  replyToCommunicationId: z.string().optional(),
  attachmentIds: z.array(z.string()).max(10).optional(),
  companyId: z.string().optional(),
  contactId: z.string().optional(),
  leadId: z.string().optional(),
  dealId: z.string().optional(),
});

// Writes and sends from a record (or replies) through the connected mailbox, logged once on the timeline (FIG-807).
// Send an Idempotency-Key: a double click or a retry returns the first answer and sends nothing twice.
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, SendSchema);
    return withIdempotency(ctx, request, body, () => sendMail(ctx, body));
  });
}
