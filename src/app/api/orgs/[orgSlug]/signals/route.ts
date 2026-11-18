import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getSignals } from "@/services/signalService";

// Adoption, stalled deals, deals past their close date and overdue tasks (FIG-1043, D2).
// Sections the caller may not see are left out. The numbers equal the list filters.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getSignals(ctx);
  });
}
