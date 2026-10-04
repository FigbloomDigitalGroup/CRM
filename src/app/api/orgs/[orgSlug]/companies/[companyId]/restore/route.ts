import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { restoreCompany } from "@/services/companyService";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; companyId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, companyId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return restoreCompany(ctx, companyId);
  });
}
