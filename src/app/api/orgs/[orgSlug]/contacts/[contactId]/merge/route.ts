import { handleRoute } from "@/app/api/_lib/handleRoute";
import { ValidationError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { mergeContacts } from "@/services/contactService";

/** Merges the contact in the URL (the "loser") into `intoContactId` (the "winner," the one that survives). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; contactId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, contactId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = (await request.json()) as { intoContactId?: string };
    if (!body.intoContactId) {
      throw new ValidationError("intoContactId is required.");
    }
    return mergeContacts(ctx, contactId, body.intoContactId);
  });
}
