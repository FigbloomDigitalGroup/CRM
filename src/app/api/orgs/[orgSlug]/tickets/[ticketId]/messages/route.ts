import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { addTicketMessage } from "@/services/ticketService";

const Schema = z.strictObject({
  kind: z.string({ error: "kind is required (CUSTOMER, STAFF or INTERNAL)." }),
  body: z.string({ error: "body is required." }),
  authorLabel: z.string().nullable().optional(),
});

/** Add a message: a customer message logged for them, a reply, or an internal note. */
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string; ticketId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, ticketId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, Schema);
    return withIdempotency(ctx, request, body, () => addTicketMessage(ctx, ticketId, body));
  });
}
