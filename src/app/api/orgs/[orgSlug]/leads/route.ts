import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { createLead, listLeads } from "@/services/leadService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { searchParams } = new URL(request.url);
    return listLeads(ctx, {
      query: searchParams.get("q") ?? undefined,
      ownerMembershipId: searchParams.get("ownerMembershipId") ?? undefined,
      leadStatusId: searchParams.get("leadStatusId") ?? undefined,
      leadSourceId: searchParams.get("leadSourceId") ?? undefined,
      temperature:
        (searchParams.get("temperature") as "HOT" | "WARM" | "COLD" | null) ??
        undefined,
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
    return createLead(ctx, body);
  });
}
