import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getTicket, updateTicket } from "@/services/ticketService";

const PatchSchema = z.strictObject({
  title: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  ownerMembershipId: z.string().nullable().optional(),
});

/** One ticket with its thread (replies, customer messages and internal notes). */
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string; ticketId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, ticketId } = await params;
    return getTicket(await resolveRequestContext(orgSlug), ticketId);
  });
}

/** Change the title, status (open, waiting on client, resolved), priority or owner. Audited. */
export async function PATCH(request: Request, { params }: { params: Promise<{ orgSlug: string; ticketId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, ticketId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return updateTicket(ctx, ticketId, await parseJsonBody(request, PatchSchema));
  });
}
