import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { mergeCompanies } from "@/services/companyService";

const MergeCompanySchema = z.object({
  intoCompanyId: requiredString("intoCompanyId is required."),
  /** Field-by-field choice from the merge screen: "loser" copies the loser value onto the surviving record. */
  fields: z.record(z.string(), z.enum(["winner", "loser"])).optional(),
});

/**
 * Merges the company in the URL (the "loser") into `intoCompanyId` (the "winner", the one that survives).
 * The response carries `mergeRecordId` and `undoExpiresAt`; POST /merges/{id}/undo reverses it in that window.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; companyId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, companyId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, MergeCompanySchema);
    return mergeCompanies(ctx, companyId, body.intoCompanyId, { fields: body.fields });
  });
}
