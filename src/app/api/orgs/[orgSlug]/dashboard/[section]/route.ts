import { handleRoute } from "@/app/api/_lib/handleRoute";
import { NotFoundError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { DASHBOARD_SECTIONS, loadSection, type DashboardSection } from "@/services/dashboardService";

// One dashboard section, loaded on its own (FIG-1042). A section the role does not have is refused with the explained no-access.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; section: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, section } = await params;
    if (!(DASHBOARD_SECTIONS as readonly string[]).includes(section)) throw new NotFoundError("Dashboard section", section);
    const ctx = await resolveRequestContext(orgSlug);
    return loadSection(ctx, section as DashboardSection);
  });
}
