import { handleRoute } from "@/app/api/_lib/handleRoute";
import { requirePlatformV2Api } from "@/app/api/platform/_lib/platformRoute";
import { endSupportAccess } from "@/services/supportAccessService";

/** End a running session now, or withdraw a request that is waiting or approved. FIG-1183 (V2). */
export async function POST(request: Request, { params }: { params: Promise<{ grantId: string }> }) {
  return handleRoute(async () => {
    const platform = await requirePlatformV2Api("platform.support.request");
    return endSupportAccess(platform, (await params).grantId, { requestId: request.headers.get("x-request-id") });
  });
}
