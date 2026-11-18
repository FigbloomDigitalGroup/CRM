import { handleRoute } from "@/app/api/_lib/handleRoute";
import { requireRecentVerification } from "@/services/platformAdminService";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { retryExport } from "@/services/platformDataRequestService";

/** Packages the export again after a failure or after its download window ended. FIG-1141. */
export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  return handleRoute(async () => {
    const platform = await requirePlatformApi("platform.data_requests.manage");
    await requireRecentVerification(platform);
    const { requestId } = await params;
    return retryExport(platform, requestId, { requestId: request.headers.get("x-request-id") });
  });
}
