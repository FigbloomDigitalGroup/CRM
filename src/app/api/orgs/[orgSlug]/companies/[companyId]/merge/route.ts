import { handleRoute } from "@/app/api/_lib/handleRoute";
import { ValidationError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { mergeCompanies } from "@/services/companyService";

/** Merges the company in the URL (the "loser") into `intoCompanyId` (the "winner," the one that survives). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; companyId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, companyId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = (await request.json()) as { intoCompanyId?: string };
    if (!body.intoCompanyId) {
      throw new ValidationError("intoCompanyId is required.");
    }
    return mergeCompanies(ctx, companyId, body.intoCompanyId);
  });
}
