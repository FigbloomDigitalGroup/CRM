import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { clearDealNextNote, getDealNextNote, setDealNextNote } from "@/services/paymentService";

const NoteSchema = z.strictObject({
  note: z.string({ error: "note is required." }),
  ownerMembershipId: z.string().nullable().optional(),
  nextOn: z.string().nullable().optional(),
});

// The one "next" follow-up note Finance keeps on a won deal (departure 1.5, FIG-1049). Finance and Management only.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; dealId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return { note: await getDealNextNote(ctx, dealId) };
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; dealId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, NoteSchema);
    return setDealNextNote(ctx, dealId, body);
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; dealId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, dealId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return clearDealNextNote(ctx, dealId);
  });
}
