import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { addEvidenceNote } from "@/services/privacyService";

const Schema = z.strictObject({ note: z.string({ error: "note is required." }) });

// Add an evidence note (who was told what, how identity was checked). Notes are timestamped and cannot be edited.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; requestId: string }> } ,
) {
  return handleRoute(async () => {
    const { orgSlug, requestId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return addEvidenceNote(ctx, requestId, (await parseJsonBody(request, Schema)).note);
  });
}
