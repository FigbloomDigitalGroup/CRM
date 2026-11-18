import { handleRoute } from "@/app/api/_lib/handleRoute";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { issuePlatformRecoveryLink } from "@/services/platformAdminService";

/** Recovery for a lost password: a single-use link (seven days) that sets a new password and resets two-step. Needs a recent verification. */
export async function POST(_request: Request, { params }: { params: Promise<{ adminId: string }> }) {
  return handleRoute(async () => {
    const context = await requirePlatformApi("platform.admins.manage");
    return issuePlatformRecoveryLink(context, (await params).adminId);
  });
}
