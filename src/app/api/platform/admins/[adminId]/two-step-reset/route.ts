import { handleRoute } from "@/app/api/_lib/handleRoute";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { resetPlatformAdminTwoStep } from "@/services/platformAdminService";

/** Recovery for a lost authenticator device: another admin removes the admin's two-step and ends their sessions; they set it up again at next sign-in. Needs a recent verification. */
export async function POST(_request: Request, { params }: { params: Promise<{ adminId: string }> }) {
  return handleRoute(async () => {
    const context = await requirePlatformApi("platform.admins.manage");
    return resetPlatformAdminTwoStep(context, (await params).adminId);
  });
}
