import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getCompany, updateCompany } from "@/services/companyService";

type RouteParams = { params: Promise<{ orgSlug: string; companyId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, companyId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getCompany(ctx, companyId);
  });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return handleRoute(async () => {
    const { orgSlug, companyId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await request.json();
    return updateCompany(ctx, companyId, body);
  });
}
