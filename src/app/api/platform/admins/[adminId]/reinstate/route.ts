import { handleRoute } from "@/app/api/_lib/handleRoute";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { reinstatePlatformAdmin } from "@/services/platformAdminService";

/** Reinstate a suspended platform admin (also clears a lock). Needs a recent verification. */
export async function POST(_request: Request, { params }: { params: Promise<{ adminId: string }> }) {
  return handleRoute(async () => {
    const context = await requirePlatformApi("platform.admins.manage");
    return reinstatePlatformAdmin(context, (await params).adminId);
  });
}
