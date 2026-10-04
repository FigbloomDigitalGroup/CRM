import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { createCompany, listCompanies } from "@/services/companyService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    return listCompanies(ctx, {
      query: searchParams.get("q") ?? undefined,
      ownerMembershipId: searchParams.get("ownerMembershipId") ?? undefined,
      includeArchived: searchParams.get("includeArchived") === "true",
    });
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await request.json();
    return createCompany(ctx, body);
  });
}
