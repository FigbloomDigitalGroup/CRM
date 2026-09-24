import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { createDeal, listDeals } from "@/services/dealService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    return listDeals(ctx, {
      query: searchParams.get("q") ?? undefined,
      ownerMembershipId: searchParams.get("ownerMembershipId") ?? undefined,
      pipelineStageId: searchParams.get("pipelineStageId") ?? undefined,
      outcome:
        (searchParams.get("outcome") as "OPEN" | "WON" | "LOST" | null) ??
        undefined,
      companyId: searchParams.get("companyId") ?? undefined,
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
    return createDeal(ctx, body);
  });
}
