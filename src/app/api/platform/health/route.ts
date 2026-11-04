import { handleRoute } from "@/app/api/_lib/handleRoute";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { checkSystemHealth } from "@/services/platformHealthService";

/** System health (PL9): API, database, jobs, email and storage probed for real, plus open incident markers. FIG-1139. */
export async function GET() {
  return handleRoute(async () => {
    await requirePlatformApi("platform.console.view");
    return checkSystemHealth();
  });
}
