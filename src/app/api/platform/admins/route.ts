import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, requiredString } from "@/app/api/_lib/validation";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { invitePlatformAdmin, listPlatformAdmins } from "@/services/platformAdminService";

const Schema = z.object({ email: requiredString("Enter an email address."), name: requiredString("Enter a name.") });

/** The platform admins, open invitations and the minimum-two count (PL10). Needs `platform.admins.manage`. */
export async function GET() {
  return handleRoute(async () => listPlatformAdmins(await requirePlatformApi("platform.admins.manage")));
}

/** Invite a platform admin (needs a recent verification). Emails a single-use link valid for seven days. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const context = await requirePlatformApi("platform.admins.manage");
    return invitePlatformAdmin(context, await parseJsonBody(request, Schema));
  });
}
