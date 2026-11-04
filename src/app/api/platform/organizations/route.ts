import { handleRoute } from "@/app/api/_lib/handleRoute";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { listOrganizationCounts } from "@/services/platformOverviewService";

/** Organisations with operational counts only (numbers, no records or values). FIG-1135. */
export async function GET() {
  return handleRoute(async () => {
    await requirePlatformApi("platform.organizations.view");
    return { organizations: await listOrganizationCounts() };
  });
}
