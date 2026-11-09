import { handleRoute } from "@/app/api/_lib/handleRoute";
import { requirePlatformV2Api } from "@/app/api/platform/_lib/platformRoute";
import { requireRecentVerification } from "@/services/platformAdminService";
import { openSupportAccess } from "@/services/supportAccessService";

/** Open an approved request: the window starts now. Needs a fresh second-step proof (R8) and the admin who asked. FIG-1183 (V2). */
export async function POST(request: Request, { params }: { params: Promise<{ grantId: string }> }) {
  return handleRoute(async () => {
    const platform = await requirePlatformV2Api("platform.support.request");
    await requireRecentVerification(platform);
    return openSupportAccess(platform, (await params).grantId, { requestId: request.headers.get("x-request-id") });
  });
}
