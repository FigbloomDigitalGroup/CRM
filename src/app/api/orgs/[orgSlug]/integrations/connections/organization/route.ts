import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { listOrganizationConnections } from "@/services/oauthConnectionService";

// Management: every live email and calendar connection in the organisation (FIG-1153).
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return listOrganizationConnections(ctx);
  });
}
