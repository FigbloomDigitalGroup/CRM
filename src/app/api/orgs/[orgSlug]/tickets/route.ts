import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { createTicket, listTickets } from "@/services/ticketService";

const ListQuerySchema = z.object({
  status: z.string().optional(),
  priority: z.string().optional(),
  ownerMembershipId: z.string().optional(),
  companyId: z.string().optional(),
  q: z.string().optional(),
  ...pageQueryShape,
});

const CreateSchema = z.strictObject({
  companyId: z.string({ error: "companyId is required." }),
  contactId: z.string().nullable().optional(),
  title: z.string({ error: "title is required." }),
  description: z.string().nullable().optional(),
  priority: z.string().optional(),
  ownerMembershipId: z.string().nullable().optional(),
});

// Customer Support tickets (FIG-1155, B6.23, V1.1): needs `tickets.manage` and the `customer_support.role` toggle.
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const ctx = await resolveRequestContext((await params).orgSlug);
    const q = parseQueryParams(new URL(request.url).searchParams, ListQuerySchema);
    return listTickets(ctx, { status: q.status, priority: q.priority, ownerMembershipId: q.ownerMembershipId, companyId: q.companyId, q: q.q }, toPageRequest(q));
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const ctx = await resolveRequestContext((await params).orgSlug);
    const body = await parseJsonBody(request, CreateSchema);
    return withIdempotency(ctx, request, body, () => createTicket(ctx, body));
  });
}
