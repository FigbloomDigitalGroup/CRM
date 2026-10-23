import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { mergeContacts } from "@/services/contactService";

const MergeContactSchema = z.object({
  intoContactId: requiredString("intoContactId is required."),
  /** Field-by-field choice from the merge screen: "loser" copies the loser value onto the surviving record. */
  fields: z.record(z.string(), z.enum(["winner", "loser"])).optional(),
});

/**
 * Merges the contact in the URL (the "loser") into `intoContactId` (the "winner", the one that survives).
 * The response carries `mergeRecordId` and `undoExpiresAt`; POST /merges/{id}/undo reverses it in that window.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; contactId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, contactId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, MergeContactSchema);
    return mergeContacts(ctx, contactId, body.intoContactId, { fields: body.fields });
  });
}
