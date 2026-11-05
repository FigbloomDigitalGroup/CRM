import { handleRoute } from "@/app/api/_lib/handleRoute";
import { requireRecentVerification } from "@/services/platformAdminService";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { resolveIncident } from "@/services/platformHealthService";

/** Marks an incident resolved. Audited. FIG-1139. */
export async function POST(request: Request, { params }: { params: Promise<{ incidentId: string }> }) {
  return handleRoute(async () => {
    const platform = await requirePlatformApi("platform.health.manage");
    await requireRecentVerification(platform);
    const { incidentId } = await params;
    return resolveIncident(platform, incidentId, request.headers.get("x-request-id"));
  });
}
