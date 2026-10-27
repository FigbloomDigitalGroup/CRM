import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getPrivacyOverview } from "@/services/privacyService";

// Settings > Data and privacy (FIG-1062, B4.05, S9): export rights, retention with the documented defaults, the legal hold, open requests. Management only.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getPrivacyOverview(ctx);
  });
}
