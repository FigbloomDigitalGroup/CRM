import { handleRoute } from "@/app/api/_lib/handleRoute";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { suspendPlatformAdmin } from "@/services/platformAdminService";

/** Suspend a platform admin (sessions end at once). Same minimum-two rule as removal. Needs a recent verification. */
export async function POST(_request: Request, { params }: { params: Promise<{ adminId: string }> }) {
  return handleRoute(async () => {
    const context = await requirePlatformApi("platform.admins.manage");
    return suspendPlatformAdmin(context, (await params).adminId);
  });
}
