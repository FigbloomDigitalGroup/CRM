import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { availableSections, getDashboard } from "@/services/dashboardService";

// The role's home page (FIG-1042): `available` lists the sections this role has, `sections` loads
// them, each on its own. Sections the role does not have are absent. Pass `?sections=list` to get
// only the list and load each section from /dashboard/{key}.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const available = availableSections(ctx);
    if (new URL(request.url).searchParams.get("sections") === "list") return { available };
    return { available, ...(await getDashboard(ctx)) };
  });
}
