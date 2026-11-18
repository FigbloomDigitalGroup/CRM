import { handleRoute } from "@/app/api/_lib/handleRoute";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { revokePlatformInvite } from "@/services/platformAdminService";

/** Withdraw an open invitation or recovery link. Needs a recent verification. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ inviteId: string }> }) {
  return handleRoute(async () => {
    const context = await requirePlatformApi("platform.admins.manage");
    return revokePlatformInvite(context, (await params).inviteId);
  });
}
