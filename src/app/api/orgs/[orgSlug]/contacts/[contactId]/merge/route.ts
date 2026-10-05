import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { mergeContacts } from "@/services/contactService";

const MergeContactSchema = z.object({
  intoContactId: requiredString("intoContactId is required."),
});

/** Merges the contact in the URL (the "loser") into `intoContactId` (the "winner," the one that survives). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; contactId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, contactId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, MergeContactSchema);
    return mergeContacts(ctx, contactId, body.intoContactId);
  });
}
