import { handleRoute } from "@/app/api/_lib/handleRoute";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { getDeletionCertificate } from "@/services/platformDataRequestService";

/** The stored deletion certificate, with a check that it still matches its hash. FIG-1141. */
export async function GET(_request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  return handleRoute(async () => {
    await requirePlatformApi("platform.organizations.view");
    const { requestId } = await params;
    return getDeletionCertificate(requestId);
  });
}
