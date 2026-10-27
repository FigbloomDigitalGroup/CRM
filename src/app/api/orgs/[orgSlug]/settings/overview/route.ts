import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getSettingsOverview } from "@/services/settingsService";

// Settings landing page (FIG-1058, B4.01, S1): profile, member counts by state, integration states. Management only.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getSettingsOverview(ctx);
  });
}
