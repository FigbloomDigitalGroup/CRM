import { handleRoute } from "@/app/api/_lib/handleRoute";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { removePlatformAdmin } from "@/services/platformAdminService";

/** Remove a platform admin. Refused when fewer than two active admins would remain, and for yourself. Needs a recent verification. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ adminId: string }> }) {
  return handleRoute(async () => {
    const context = await requirePlatformApi("platform.admins.manage");
    return removePlatformAdmin(context, (await params).adminId);
  });
}
