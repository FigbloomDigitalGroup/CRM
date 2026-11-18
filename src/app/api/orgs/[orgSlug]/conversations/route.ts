import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { listConversations, logUnlinkedConversation } from "@/services/conversationService";

const ListQuerySchema = z.object({
  /** ALL, EMAIL, WHATSAPP, CALLS, MEETINGS or NOTES. */
  tab: z.string().optional(),
  direction: z.string().optional(),
  ownerMembershipId: z.string().optional(),
  q: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  ...pageQueryShape,
});

const LogUnlinkedSchema = z.strictObject({
  channel: z.enum(["EMAIL", "PHONE", "WHATSAPP", "SMS", "MEETING", "OTHER"]),
  direction: z.enum(["INBOUND", "OUTBOUND"]),
  summary: z.string({ error: "summary is required." }),
  subject: z.string().optional(),
  occurredAt: z.string().optional(),
  counterpartyName: z.string().optional(),
  counterpartyEmail: z.string().optional(),
  counterpartyPhone: z.string().optional(),
});

// The Conversations hub (design E1, FIG-1053): every email, call, WhatsApp message, meeting and note, with tab counts.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, ListQuerySchema);
    return listConversations(ctx, { tab: query.tab, direction: query.direction, ownerMembershipId: query.ownerMembershipId, q: query.q, from: query.from, to: query.to }, toPageRequest(query));
  });
}

// Logs a call or message that matches no record yet: it waits in the Needs-linking queue.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, LogUnlinkedSchema);
    return withIdempotency(ctx, request, body, () => logUnlinkedConversation(ctx, body));
  });
}
