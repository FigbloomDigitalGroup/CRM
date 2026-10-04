import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { updateCompanyService } from "@/services/companyServiceLinkService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; companyServiceId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, companyServiceId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await request.json();
    return updateCompanyService(ctx, companyServiceId, body);
  });
}
