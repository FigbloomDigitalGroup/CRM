import { handleRoute } from "@/app/api/_lib/handleRoute";
import { requirePlatformV2Api } from "@/app/api/platform/_lib/platformRoute";
import { getSupportAccess } from "@/services/supportAccessService";

/** One request or session with its page-view log (PL7). FIG-1183 (V2). */
export async function GET(_request: Request, { params }: { params: Promise<{ grantId: string }> }) {
  return handleRoute(async () => {
    await requirePlatformV2Api("platform.support.request");
    return getSupportAccess((await params).grantId);
  });
}
