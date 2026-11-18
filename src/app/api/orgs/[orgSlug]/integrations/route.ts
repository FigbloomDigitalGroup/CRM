import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { listIntegrations } from "@/services/integrationRegistryService";

// The integrations registry (FIG-1060, B4.03, S6): every integration with Connected, Not connected or Planned. Management only.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return listIntegrations(ctx);
  });
}
