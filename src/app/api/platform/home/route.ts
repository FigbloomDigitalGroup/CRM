import { handleRoute } from "@/app/api/_lib/handleRoute";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { getPlatformHome } from "@/services/platformHealthService";

/** Platform home (PL1): organisation counts, open requests, component health, last audit verification. Numbers only. FIG-1139. */
export async function GET() {
  return handleRoute(async () => {
    await requirePlatformApi("platform.console.view");
    return getPlatformHome();
  });
}
