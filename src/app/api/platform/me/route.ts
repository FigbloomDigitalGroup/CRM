import { handleRoute } from "@/app/api/_lib/handleRoute";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";

/** Who the platform admin is and which `platform.*` keys they hold. Never an organisation. FIG-1135. */
export async function GET() {
  return handleRoute(async () => {
    const context = await requirePlatformApi("platform.console.view");
    return {
      id: context.identityId,
      email: context.email,
      name: context.name,
      permissionKeys: [...context.permissions].sort(),
    };
  });
}
