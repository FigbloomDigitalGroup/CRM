import { handleRoute } from "@/app/api/_lib/handleRoute";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { previewProvisioningDefaults } from "@/services/platformOrganizationService";

/** What a new organisation will start with (PL3). FIG-1136. */
export async function GET() {
  return handleRoute(async () => {
    await requirePlatformApi("platform.organizations.provision");
    return previewProvisioningDefaults();
  });
}
